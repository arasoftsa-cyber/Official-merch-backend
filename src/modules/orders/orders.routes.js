const express = require("express");
const { randomUUID } = require("crypto");
const { z } = require("zod");
const { getDb } = require("../../core/db/db");
const { requireAuth } = require("../../core/http/auth.middleware");
const { ok, fail } = require("../../core/http/errorResponse");
const rateLimit = require("../../core/http/rateLimit");
const { orderSpamGuard } = require("../../core/http/spamDetection");
const { startPaymentForOrder, confirmAttempt } = require("../payments/payments.api");

const router = express.Router();

const PRODUCT_NOT_FOUND = "product_not_found";
const OUT_OF_STOCK = "out_of_stock";
const FORBIDDEN = "forbidden";
const ORDER_NOT_FOUND = "order_not_found";
const ORDER_NOT_PAYABLE = "order_not_payable";
const VALIDATION_ERROR = "validation_error";
const ORDER_ALREADY_CANCELLED = "order_already_cancelled";
const ORDER_NOT_CANCELLABLE = "order_not_cancellable";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderLineSchema = z.object({
  productId: z.string().trim().regex(UUID_RE, "productId must be a valid UUID"),
  productVariantId: z
    .string()
    .trim()
    .regex(UUID_RE, "productVariantId must be a valid UUID"),
  quantity: z.coerce
    .number()
    .int("quantity must be an integer")
    .min(1, "quantity must be at least 1")
    .max(10, "quantity must be at most 10"),
});
const orderItemsSchema = z
  .array(orderLineSchema)
  .min(1, "items must contain at least one item")
  .max(50, "items cannot exceed 50 items");

const parseOrderItems = (body) => {
  if (Array.isArray(body?.items)) {
    return orderItemsSchema.parse(body.items);
  }

  return orderItemsSchema.parse([
    {
      productId: body?.productId,
      productVariantId: body?.productVariantId,
      quantity: body?.quantity,
    },
  ]);
};

const orderCreateLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
});

const paymentLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
});

const formatOrder = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    buyerUserId: row.buyer_user_id,
    status: row.status,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const formatItem = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    productVariantId: row.product_variant_id,
    quantity: row.quantity,
    priceCents: row.price_cents,
    createdAt: row.created_at,
  };
};

const formatEvent = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    actorUserId: row.actor_user_id,
    note: row.note,
    createdAt: row.created_at,
  };
};

const BUYER_ROLES = new Set(["buyer"]);
const getRole = (user) => (user ? (user.role || user.userRole || "").toString().toLowerCase() : "");
const isBuyer = (user) => BUYER_ROLES.has(getRole(user));

const rejectIfNotBuyer = (req, res) => {
  if (!isBuyer(req.user)) {
    fail(res, 403, FORBIDDEN, "Forbidden");
    return false;
  }
  return true;
};

const requireBuyer = (req, res, next) => {
  if (rejectIfNotBuyer(req, res)) {
    next();
  }
};

const listOrdersHandler = async (req, res, next) => {
  try {
    if (!rejectIfNotBuyer(req, res)) return;
    const db = getDb();
    const orders = await db("orders")
      .where({ buyer_user_id: req.user.id })
      .select("id", "status", "total_cents as totalCents", "created_at")
      .orderBy("created_at", "desc")
      .limit(50);

    const orderIds = orders.map((order) => order.id);
    let counts = [];
    let payments = [];
    if (orderIds.length) {
      counts = await db("order_items")
        .whereIn("order_id", orderIds)
        .groupBy("order_id")
        .select("order_id")
        .count("id as itemsCount");
      const paymentRows = await db("payments")
        .whereIn("order_id", orderIds)
        .select("order_id", "id", "status", "provider", "created_at")
        .orderBy("order_id")
        .orderBy("created_at", "desc");
      payments = [];
      const seen = new Set();
      for (const row of paymentRows) {
        if (!seen.has(row.order_id)) {
          seen.add(row.order_id);
          payments.push(row);
        }
      }
    }

    const countMap = counts.reduce((acc, row) => {
      acc[row.order_id] = Number(row.itemsCount);
      return acc;
    }, {});

    const paymentMap = payments.reduce((acc, payment) => {
      if (!acc[payment.order_id]) {
        acc[payment.order_id] = {
          status: payment.status,
          attemptId: payment.id,
          provider: payment.provider,
        };
      }
      return acc;
    }, {});

    ok(res, {
      items: orders.map((order) => ({
        id: order.id,
        status: order.status,
        totalCents: order.totalCents ?? order.total_cents ?? null,
        createdAt: order.created_at,
        itemsCount: countMap[order.id] || 0,
        payment:
          paymentMap[order.id] || { status: "unpaid", attemptId: null, provider: null },
      })),
    });
  } catch (err) {
    next(err);
  }
};

router.get("/my", requireAuth, requireBuyer, listOrdersHandler);

router.get("/", requireAuth, requireBuyer, listOrdersHandler);

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!rejectIfNotBuyer(req, res)) return;
    const db = getDb();
    const order = await db("orders").where({ id: req.params.id }).first();
    if (!order) {
      return fail(res, 404, ORDER_NOT_FOUND, "Order not found");
    }
    if (order.buyer_user_id !== req.user.id) {
      return fail(res, 403, FORBIDDEN, "Forbidden");
    }
    const items = await db("order_items").where({ order_id: order.id }).select();
    const paymentRow = await db("payments")
      .where({ order_id: order.id })
      .select("id", "status", "created_at")
      .orderBy("created_at", "desc")
      .first();
    const payment = paymentRow
      ? { status: paymentRow.status, attemptId: paymentRow.id }
      : { status: "unpaid", attemptId: null };
    ok(res, {
      id: order.id,
      status: order.status,
      totalCents: order.total_cents,
      createdAt: order.created_at,
      items: items.map(formatItem),
      payment,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/events", requireAuth, async (req, res, next) => {
  try {
    if (!rejectIfNotBuyer(req, res)) return;
    const db = getDb();
    const order = await db("orders").where({ id: req.params.id }).first();
    if (!order) {
      return fail(res, 404, ORDER_NOT_FOUND, "Order not found");
    }
    if (order.buyer_user_id !== req.user.id) {
      return fail(res, 403, FORBIDDEN, "Forbidden");
    }
    const events = await db("order_events")
      .where({ order_id: order.id })
      .orderBy("created_at", "asc");
    ok(res, {
      items: events.map(formatEvent),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    if (!rejectIfNotBuyer(req, res)) return;
    const db = getDb();
    const orderId = req.params.id;
    const fetchOrder = async () =>
      db("orders").where({ id: orderId }).first();
    let order = await fetchOrder();
    if (!order) {
      let attempts = 0;
      while (!order && attempts < 5) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        order = await fetchOrder();
        attempts += 1;
      }
    }
    if (!order) {
      return fail(res, 404, ORDER_NOT_FOUND, "Order not found");
    }
    if (order.buyer_user_id !== req.user.id) {
      return fail(res, 403, FORBIDDEN, "Forbidden");
    }
    const items = await db("order_items")
      .where({ order_id: orderId })
      .select(
        "id",
        "product_id",
        "product_variant_id",
        "quantity",
        "price_cents",
        "created_at"
      );

    if (order.status === "cancelled") {
      return fail(res, 400, ORDER_ALREADY_CANCELLED, "Order is already cancelled");
    }

    if (order.status !== "placed" && order.status !== "unpaid") {
      return fail(res, 400, ORDER_NOT_CANCELLABLE, "Order is not cancellable");
    }

    const canceled = await db.transaction(async (trx) => {
      const now = trx.fn.now();
      await trx("orders").where({ id: orderId }).update({
        status: "cancelled",
        updated_at: now,
      });
      const items = await trx("order_items")
        .where({ order_id: orderId })
        .select(
          "id",
          "product_id",
          "product_variant_id",
          "quantity",
          "price_cents",
          "created_at"
        );

      for (const item of items) {
        await trx("product_variants")
          .where({ id: item.product_variant_id })
          .increment("stock", item.quantity);
      }

      await trx("order_events").insert({
        order_id: orderId,
        type: "cancelled",
        actor_user_id: req.user.id,
      });

      const updatedOrder = await trx("orders").where({ id: orderId }).first();
      return { order: updatedOrder, items };
    });

    ok(res, {
      id: canceled.order.id,
      status: canceled.order.status,
      totalCents: canceled.order.total_cents,
      createdAt: canceled.order.created_at,
      items: canceled.items.map(formatItem),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/pay", requireAuth, express.json(), paymentLimiter, async (req, res, next) => {
  try {
    if (!rejectIfNotBuyer(req, res)) return;
    const result = await startPaymentForOrder({
      knex: getDb(),
      orderId: req.params.id,
      buyerUserId: req.user.id,
    });
    const paymentId = result.paymentId;
    const confirmPath = paymentId
      ? `/api/payments/mock/confirm/${paymentId}`
      : null;
    return ok(res, {
      ok: true,
      paymentId,
      status: result.status,
      attemptId: paymentId,
      confirmPath,
      mock: confirmPath ? { confirmPath } : null,
    });
  } catch (error) {
    if (error.code === "ORDER_NOT_FOUND") {
      return fail(res, 404, ORDER_NOT_FOUND, "Order not found");
    }
    if (error.code === "ORDER_NOT_PAYABLE") {
      return fail(res, 400, ORDER_NOT_PAYABLE, "Order is not payable");
    }
    next(error);
  }
});

  router.post(
    "/",
    requireAuth,
    requireBuyer,
    express.json(),
    orderCreateLimiter,
    orderSpamGuard,
    async (req, res, next) => {
      if (!isBuyer(req.user)) {
        return fail(res, 403, FORBIDDEN, "Forbidden");
      }
      console.log(
        "[DBG orders POST]",
        "file=orders.routes.js",
        "role=",
        req.user?.role || req.user?.userRole,
        "userId=",
        req.user?.id,
        "url=",
        req.originalUrl
      );
      try {
        if (!rejectIfNotBuyer(req, res)) return;
        let normalized;
        try {
          normalized = parseOrderItems(req.body || {});
        } catch (validationErr) {
          if (validationErr instanceof z.ZodError) {
            return fail(res, 400, VALIDATION_ERROR, "Invalid order payload.", {
              details: validationErr.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            });
          }
          throw validationErr;
        }

        const db = getDb();
        const order = await db.transaction(async (trx) => {
          const now = trx.fn.now();
          const supportsReturning = (trx.client?.config?.client || "").includes("pg");
          let totalCents = 0;
          const details = [];
          for (const line of normalized) {
            const baseStockUpdate = trx("product_variants")
              .where({
                id: line.productVariantId,
                product_id: line.productId,
              })
              .andWhere("stock", ">=", line.quantity);

            let variant;
            if (supportsReturning) {
              const updatedRows = await baseStockUpdate
                .clone()
                .update({
                  stock: trx.raw("stock - ?", [line.quantity]),
                })
                .returning("*");
              variant = updatedRows[0];
            } else {
              const updatedCount = await baseStockUpdate.update({
                stock: trx.raw("stock - ?", [line.quantity]),
              });
              if (Number(updatedCount) > 0) {
                variant = await trx("product_variants")
                  .where({
                    id: line.productVariantId,
                    product_id: line.productId,
                  })
                  .first();
              }
            }

            if (!variant) {
              const err = new Error("out_of_stock");
              err.code = "OUT_OF_STOCK";
              throw err;
            }

            totalCents += variant.price_cents * line.quantity;
            details.push({ line, variant });
          }
          const orderId = randomUUID();
          await trx("orders").insert({
            id: orderId,
            buyer_user_id: req.user.id,
            status: "placed",
            total_cents: totalCents,
            created_at: now,
            updated_at: now,
          });

          await trx("payments")
            .insert({
              order_id: orderId,
              status: "unpaid",
              provider: "mock",
              amount_cents: totalCents,
              currency: "INR",
            })
            .onConflict("order_id")
            .ignore();

          for (const detail of details) {
            await trx("order_items").insert({
              id: randomUUID(),
              order_id: orderId,
              product_id: detail.line.productId,
              product_variant_id: detail.line.productVariantId,
              quantity: detail.line.quantity,
              price_cents: detail.variant.price_cents,
              created_at: now,
            });
          }

          await trx("order_events").insert({
            order_id: orderId,
            type: "placed",
            actor_user_id: req.user.id,
          });

          return trx("orders").where({ id: orderId }).first();
        });

        const items = await db("order_items").where({ order_id: order.id }).select();
        ok(res, {
          order: formatOrder(order),
          items: items.map(formatItem),
        });
      } catch (err) {
        if (err?.code === "PRODUCT_NOT_FOUND") {
          return fail(res, 404, PRODUCT_NOT_FOUND, "Product not found");
        }
        if (err?.code === "OUT_OF_STOCK") {
          return fail(res, 400, OUT_OF_STOCK, "Out of stock");
        }
        next(err);
      }
    }
  );

module.exports = router;
