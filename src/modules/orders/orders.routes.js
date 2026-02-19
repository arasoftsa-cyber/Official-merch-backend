const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");
const { requireAuth } = require("../../middleware/auth.middleware");
const rateLimit = require("../../middleware/rateLimit");
const { orderSpamGuard } = require("../../middleware/spamDetection");
const { startPaymentForOrder, confirmAttempt } = require("../../payments/paymentService");

const router = express.Router();

const BAD_REQUEST = { error: "invalid_request" };
const PRODUCT_NOT_FOUND = { error: "product_not_found" };
const OUT_OF_STOCK = { error: "out_of_stock" };
const FORBIDDEN = { error: "forbidden" };
const ORDER_NOT_FOUND = { error: "order_not_found" };
const ORDER_NOT_CANCELLABLE = { error: "order_not_cancellable" };
const ORDER_NOT_PAYABLE = { error: "order_not_payable" };

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
    res.status(403).json(FORBIDDEN);
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

    res.json({
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
      return res.status(404).json(ORDER_NOT_FOUND);
    }
    if (order.buyer_user_id !== req.user.id) {
      return res.status(403).json(FORBIDDEN);
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
    res.json({
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
      return res.status(404).json(ORDER_NOT_FOUND);
    }
    if (order.buyer_user_id !== req.user.id) {
      return res.status(403).json(FORBIDDEN);
    }
    const events = await db("order_events")
      .where({ order_id: order.id })
      .orderBy("created_at", "asc");
    res.json({
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
      return res.status(404).json(ORDER_NOT_FOUND);
    }
    if (order.buyer_user_id !== req.user.id) {
      return res.status(403).json(FORBIDDEN);
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
      return res.status(400).json({ error: "order_already_cancelled" });
    }

    if (order.status !== "placed" && order.status !== "unpaid") {
      return res.status(400).json({ error: "order_not_cancellable" });
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

    res.json({
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
    return res.json({
      ok: true,
      paymentId,
      status: result.status,
      attemptId: paymentId,
      confirmPath,
      mock: confirmPath ? { confirmPath } : null,
    });
  } catch (error) {
    if (error.code === "ORDER_NOT_FOUND") {
      return res.status(404).json(ORDER_NOT_FOUND);
    }
    if (error.code === "ORDER_NOT_PAYABLE") {
      return res.status(400).json(ORDER_NOT_PAYABLE);
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
        return res.status(403).json(FORBIDDEN);
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
        const { items: rawItems, productId, productVariantId, quantity } = req.body || {};
        const candidates =
          Array.isArray(rawItems) && rawItems.length
            ? rawItems
            : [{ productId, productVariantId, quantity }];
        const normalized = candidates
          .map((line) => ({
            productId: line?.productId,
            productVariantId: line?.productVariantId,
            quantity: Number(line?.quantity),
          }))
          .filter(
            (line) =>
              line.productId &&
              line.productVariantId &&
              Number.isFinite(line.quantity)
          );
        if (!normalized.length || normalized.some((line) => line.quantity <= 0)) {
          return res.status(400).json(BAD_REQUEST);
        }

        const db = getDb();
        const order = await db.transaction(async (trx) => {
          const now = trx.fn.now();
          let totalCents = 0;
          const details = [];
          for (const line of normalized) {
            const variant = await trx("product_variants")
              .where({
                id: line.productVariantId,
                product_id: line.productId,
              })
              .forUpdate()
              .first();
            if (!variant) {
              const err = new Error("product_not_found");
              err.code = "PRODUCT_NOT_FOUND";
              throw err;
            }
            if (variant.stock < line.quantity) {
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
            await trx("product_variants")
              .where({ id: detail.variant.id })
              .update({ stock: detail.variant.stock - detail.line.quantity });

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
        res.json({
          order: formatOrder(order),
          items: items.map(formatItem),
        });
      } catch (err) {
        if (err?.code === "PRODUCT_NOT_FOUND") {
          return res.status(404).json(PRODUCT_NOT_FOUND);
        }
        if (err?.code === "OUT_OF_STOCK") {
          return res.status(400).json(OUT_OF_STOCK);
        }
        next(err);
      }
    }
  );

module.exports = router;
