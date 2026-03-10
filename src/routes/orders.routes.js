const express = require("express");
const { randomUUID } = require("crypto");
const { z } = require("zod");
const { getDb } = require("../core/db/db");
const { requireAuth } = require("../core/http/auth.middleware");
const { ok, fail } = require("../core/http/errorResponse");
const rateLimit = require("../core/http/rateLimit");
const { orderSpamGuard } = require("../core/http/spamDetection");
const { startPaymentForOrder } = require("../core/payments/paymentService");
const {
  isNonNegativeInteger,
  resolveOurShareCents,
} = require("../utils/economics");

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

const asNullableNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asBoolean = (value) => value === true || value === "true" || value === 1 || value === "1";

const parseOptionalEconomicsInt = (value, field) => {
  const parsed = asNullableNumber(value);
  if (parsed === null) return { value: null, error: null };
  if (!isNonNegativeInteger(parsed)) {
    return { value: null, error: `invalid_${field}` };
  }
  return { value: parsed, error: null };
};

const normalizeVariantEconomicsForCheckout = (variant) => {
  const sellingPriceCents = asNullableNumber(variant?.selling_price_cents);
  if (!isNonNegativeInteger(sellingPriceCents)) {
    return { error: "invalid_selling_price_cents" };
  }

  const vendor = parseOptionalEconomicsInt(variant?.vendor_payout_cents, "vendor_payout_cents");
  if (vendor.error) return { error: vendor.error };
  const royalty = parseOptionalEconomicsInt(variant?.royalty_cents, "royalty_cents");
  if (royalty.error) return { error: royalty.error };
  const share = parseOptionalEconomicsInt(variant?.our_share_cents, "our_share_cents");
  if (share.error) return { error: share.error };

  const shareResolution = resolveOurShareCents({
    sellingPriceCents,
    vendorPayoutCents: vendor.value === null ? undefined : vendor.value,
    royaltyCents: royalty.value === null ? undefined : royalty.value,
    ourShareCents: share.value === null ? undefined : share.value,
  });
  if (shareResolution.error) {
    return { error: shareResolution.error };
  }
  if (
    share.value === null &&
    vendor.value !== null &&
    royalty.value !== null &&
    typeof shareResolution.ourShareCents !== "number"
  ) {
    return { error: "invalid_our_share_cents" };
  }

  return {
    error: null,
    value: {
      ...variant,
      selling_price_cents: sellingPriceCents,
      vendor_payout_cents: vendor.value,
      royalty_cents: royalty.value,
      our_share_cents:
        typeof shareResolution.ourShareCents === "number"
          ? shareResolution.ourShareCents
          : null,
    },
  };
};

const isVariantEffectivelySellable = (variant) => {
  if (!variant) return false;
  const productActive = asBoolean(variant.product_is_active);
  const variantListed = variant.is_listed === undefined ? true : asBoolean(variant.is_listed);
  const skuActive = asBoolean(variant.sku_is_active);
  const stock = Number(variant.stock ?? 0);
  return productActive && variantListed && skuActive && stock > 0;
};

const getOrderItemColumns = async (trx) => trx("order_items").columnInfo();

const buildOrderItemInsertPayload = ({
  columns = {},
  orderId,
  line,
  variant,
  now,
}) => {
  const hasColumn = (name) => Object.prototype.hasOwnProperty.call(columns, name);
  const payload = {
    id: randomUUID(),
    order_id: orderId,
    product_id: line.productId,
    product_variant_id: line.productVariantId,
    quantity: line.quantity,
    price_cents: variant.selling_price_cents,
    created_at: now,
  };

  if (hasColumn("inventory_sku_id")) payload.inventory_sku_id = variant.inventory_sku_id || null;
  if (hasColumn("supplier_sku")) payload.supplier_sku = variant.supplier_sku || null;
  if (hasColumn("merch_type")) payload.merch_type = variant.merch_type || null;
  if (hasColumn("quality_tier")) payload.quality_tier = variant.quality_tier || null;
  if (hasColumn("size")) payload.size = variant.size || null;
  if (hasColumn("color")) payload.color = variant.color || null;
  if (hasColumn("selling_price_cents")) payload.selling_price_cents = variant.selling_price_cents;
  if (hasColumn("vendor_payout_cents")) {
    payload.vendor_payout_cents =
      variant.vendor_payout_cents == null ? null : Number(variant.vendor_payout_cents);
  }
  if (hasColumn("royalty_cents")) {
    payload.royalty_cents = variant.royalty_cents == null ? null : Number(variant.royalty_cents);
  }
  if (hasColumn("our_share_cents")) {
    payload.our_share_cents =
      variant.our_share_cents == null ? null : Number(variant.our_share_cents);
  }
  return payload;
};

const fetchVariantForCheckout = async (trx, line) =>
  trx("product_variants as pv")
    .join("products as p", "p.id", "pv.product_id")
    .leftJoin("inventory_skus as sk", "sk.id", "pv.inventory_sku_id")
    .where("pv.id", line.productVariantId)
    .andWhere("pv.product_id", line.productId)
    .select(
      "pv.id",
      "pv.product_id",
      "pv.inventory_sku_id",
      "pv.is_listed",
      "p.is_active as product_is_active",
      "sk.supplier_sku",
      "sk.merch_type",
      "sk.quality_tier",
      "sk.size",
      "sk.color",
      "sk.stock",
      "sk.is_active as sku_is_active",
      trx.raw("coalesce(pv.selling_price_cents, pv.price_cents) as selling_price_cents"),
      trx.raw("coalesce(pv.vendor_payout_cents, p.vendor_payout_cents) as vendor_payout_cents"),
      trx.raw("coalesce(pv.royalty_cents, p.royalty_cents) as royalty_cents"),
      trx.raw("coalesce(pv.our_share_cents, p.our_share_cents) as our_share_cents")
    )
    .first();

const decrementInventorySkuStock = async ({ trx, inventorySkuId, quantity, now }) =>
  trx("inventory_skus")
    .where({ id: inventorySkuId, is_active: true })
    .andWhere("stock", ">=", quantity)
    .update({
      stock: trx.raw("stock - ?", [quantity]),
      updated_at: now,
    });

const reserveInventoryForLine = async ({
  trx,
  line,
  now,
  loadVariant = fetchVariantForCheckout,
  decrementInventory = decrementInventorySkuStock,
}) => {
  const rawVariant = await loadVariant(trx, line);
  if (!rawVariant) {
    const err = new Error("product_not_found");
    err.code = "PRODUCT_NOT_FOUND";
    throw err;
  }
  const normalizedEconomics = normalizeVariantEconomicsForCheckout(rawVariant);
  if (normalizedEconomics.error) {
    const err = new Error(normalizedEconomics.error);
    err.code = "INVALID_VARIANT_ECONOMICS";
    throw err;
  }
  const variant = normalizedEconomics.value;
  if (!variant.inventory_sku_id || !isVariantEffectivelySellable(variant)) {
    const err = new Error("out_of_stock");
    err.code = "OUT_OF_STOCK";
    throw err;
  }
  const availableStock = Number(variant.stock ?? 0);
  if (!Number.isFinite(availableStock) || availableStock < line.quantity) {
    const err = new Error("out_of_stock");
    err.code = "OUT_OF_STOCK";
    throw err;
  }

  const updated = await decrementInventory({
    trx,
    inventorySkuId: variant.inventory_sku_id,
    quantity: line.quantity,
    now,
  });
  if (Number(updated) < 1) {
    const err = new Error("out_of_stock");
    err.code = "OUT_OF_STOCK";
    throw err;
  }
  return variant;
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
    inventorySkuId: row.inventory_sku_id || null,
    supplierSku: row.supplier_sku || null,
    merchType: row.merch_type || null,
    qualityTier: row.quality_tier || null,
    size: row.size || null,
    color: row.color || null,
    sellingPriceCents:
      asNullableNumber(row.selling_price_cents) ?? asNullableNumber(row.price_cents),
    vendorPayoutCents: asNullableNumber(row.vendor_payout_cents),
    royaltyCents: asNullableNumber(row.royalty_cents),
    ourShareCents: asNullableNumber(row.our_share_cents),
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

const BUYER_ROLES = new Set(["buyer", "fan", "artist", "label", "admin"]);
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
        "inventory_sku_id",
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
          "inventory_sku_id",
          "quantity",
          "price_cents",
          "created_at"
        );

      const unresolvedVariantIds = items
        .filter((item) => !item.inventory_sku_id && item.product_variant_id)
        .map((item) => item.product_variant_id);
      const fallbackSkuMap = new Map();
      if (unresolvedVariantIds.length > 0) {
        const variantRows = await trx("product_variants")
          .select("id", "inventory_sku_id")
          .whereIn("id", unresolvedVariantIds);
        for (const row of variantRows) {
          if (row?.id && row?.inventory_sku_id) {
            fallbackSkuMap.set(row.id, row.inventory_sku_id);
          }
        }
      }

      for (const item of items) {
        const inventorySkuId =
          item.inventory_sku_id || fallbackSkuMap.get(item.product_variant_id) || null;
        if (!inventorySkuId) continue;
        await trx("inventory_skus")
          .where({ id: inventorySkuId })
          .update({
            stock: trx.raw("stock + ?", [item.quantity]),
            updated_at: now,
          });
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
          let totalCents = 0;
          const details = [];
          const orderItemColumns = await getOrderItemColumns(trx);
          for (const line of normalized) {
            const variant = await reserveInventoryForLine({ trx, line, now });
            const linePriceCents = Number(variant.selling_price_cents ?? 0);
            totalCents += linePriceCents * line.quantity;
            details.push({ line, variant, orderItemColumns });
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
            await trx("order_items").insert(
              buildOrderItemInsertPayload({
                columns: detail.orderItemColumns,
                orderId,
                line: detail.line,
                variant: detail.variant,
                now,
              })
            );
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
        if (err?.code === "INVALID_VARIANT_ECONOMICS") {
          return fail(res, 400, VALIDATION_ERROR, "Invalid variant economics");
        }
        if (err?.code === "OUT_OF_STOCK") {
          return fail(res, 400, OUT_OF_STOCK, "Out of stock");
        }
        next(err);
      }
    }
  );

module.exports = router;
module.exports.__test = {
  isVariantEffectivelySellable,
  normalizeVariantEconomicsForCheckout,
  buildOrderItemInsertPayload,
  decrementInventorySkuStock,
  reserveInventoryForLine,
};
