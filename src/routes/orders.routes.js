const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { assertOrderItemSnapshotSchema } = require("../core/db/schemaContract");
const { requireAuth } = require("../core/http/auth.middleware");
const { ok, fail } = require("../core/http/errorResponse");
const rateLimit = require("../core/http/rateLimit");
const { orderSpamGuard } = require("../core/http/spamDetection");
const { startPaymentForOrder } = require("../core/payments/paymentService");
const {
  getSystemCurrency,
  assertSupportedCurrency,
} = require("../config/currency");
const {
  normalizeCreateOrderPayload,
  validateCreateOrderPayload,
  normalizeOrderPaymentPayload,
} = require("../contracts/orders.contract");
const { logLegacyContractUse } = require("../contracts/shared");
const { sendEmailByTemplate } = require("../services/email.service");
const { buildPublicAppUrl } = require("../services/appPublicUrl.service");
const {
  isNonNegativeInteger,
  resolveOurShareCents,
} = require("../utils/economics");

const { registerOrderReadRoutes } = require("./orders/read.routes");
const { registerOrderLifecycleRoutes } = require("./orders/lifecycle.routes");
const { registerOrderCreateRoutes } = require("./orders/create.routes");

const router = express.Router();

const PRODUCT_NOT_FOUND = "product_not_found";
const OUT_OF_STOCK = "out_of_stock";
const FORBIDDEN = "forbidden";
const ORDER_NOT_FOUND = "order_not_found";
const ORDER_NOT_PAYABLE = "order_not_payable";
const VALIDATION_ERROR = "validation_error";
const ORDER_ALREADY_CANCELLED = "order_already_cancelled";
const ORDER_NOT_CANCELLABLE = "order_not_cancellable";
const CURRENCY_MISMATCH = "currency_mismatch";

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

const buildOrderItemInsertPayload = ({ orderId, line, variant, now }) => ({
    id: randomUUID(),
    order_id: orderId,
    product_id: line.productId,
    product_variant_id: line.productVariantId,
    quantity: line.quantity,
    price_cents: variant.selling_price_cents,
    inventory_sku_id: variant.inventory_sku_id || null,
    supplier_sku: variant.supplier_sku || null,
    merch_type: variant.merch_type || null,
    quality_tier: variant.quality_tier || null,
    size: variant.size || null,
    color: variant.color || null,
    selling_price_cents: variant.selling_price_cents,
    vendor_payout_cents:
      variant.vendor_payout_cents == null ? null : Number(variant.vendor_payout_cents),
    royalty_cents: variant.royalty_cents == null ? null : Number(variant.royalty_cents),
    our_share_cents: variant.our_share_cents == null ? null : Number(variant.our_share_cents),
    created_at: now,
  });

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
    currency: getSystemCurrency(),
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

const ORDER_DEFAULT_VIEW_PATH = "/fan/orders";
const ORDER_STATUS_MESSAGES = Object.freeze({
  cancelled: "Your order has been cancelled.",
});

const resolveOrderEmailRecipient = async ({ db, user }) => {
  const directEmail = String(user?.email || "").trim().toLowerCase();
  if (directEmail) return directEmail;

  const userId = String(user?.id || "").trim();
  if (!userId) return "";

  const row = await db("users").where({ id: userId }).first("email");
  return String(row?.email || "").trim().toLowerCase();
};

const sendOrderConfirmationEmailBestEffort = async ({ db, user, order, items }) => {
  try {
    const recipientEmail = await resolveOrderEmailRecipient({ db, user });
    if (!recipientEmail || !order?.id) return;

    const orderUrl =
      buildPublicAppUrl({ path: `${ORDER_DEFAULT_VIEW_PATH}/${order.id}` }) ||
      buildPublicAppUrl({ path: ORDER_DEFAULT_VIEW_PATH });

    const result = await sendEmailByTemplate({
      templateKey: "order-confirmation",
      to: recipientEmail,
      payload: {
        orderId: order.id,
        totalCents: order.total_cents,
        currency: getSystemCurrency(),
        itemCount: Array.isArray(items) ? items.length : null,
        orderUrl,
      },
      metadata: {
        flow: "order_confirmation",
        orderId: order.id,
      },
    });

    if (result.errorCode && !result.skipped) {
      console.warn("[orders.email] order confirmation failed", {
        orderId: order.id,
        code: result.errorCode,
      });
    }
  } catch (err) {
    console.warn(
      "[orders.email] order confirmation failed",
      err?.code || err?.message || err
    );
  }
};

const sendOrderStatusUpdateEmailBestEffort = async ({ db, user, orderId, status }) => {
  try {
    const safeOrderId = String(orderId || "").trim();
    const safeStatus = String(status || "").trim().toLowerCase();
    if (!safeOrderId || !safeStatus) return;

    const recipientEmail = await resolveOrderEmailRecipient({ db, user });
    if (!recipientEmail) return;

    const orderUrl =
      buildPublicAppUrl({ path: `${ORDER_DEFAULT_VIEW_PATH}/${safeOrderId}` }) ||
      buildPublicAppUrl({ path: ORDER_DEFAULT_VIEW_PATH });

    const result = await sendEmailByTemplate({
      templateKey: "order-status-update",
      to: recipientEmail,
      payload: {
        orderId: safeOrderId,
        status: safeStatus,
        orderUrl,
        message: ORDER_STATUS_MESSAGES[safeStatus] || "",
      },
      metadata: {
        flow: "order_status_update",
        orderId: safeOrderId,
        status: safeStatus,
      },
    });

    if (result.errorCode && !result.skipped) {
      console.warn("[orders.email] status update failed", {
        orderId: safeOrderId,
        status: safeStatus,
        code: result.errorCode,
      });
    }
  } catch (err) {
    console.warn("[orders.email] status update failed", err?.code || err?.message || err);
  }
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
        currency: getSystemCurrency(),
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


registerOrderReadRoutes(router, {
  requireAuth,
  requireBuyer,
  listOrdersHandler,
  rejectIfNotBuyer,
  getDb,
  fail,
  ORDER_NOT_FOUND,
  FORBIDDEN,
  ok,
  formatItem,
  formatEvent,
});

registerOrderLifecycleRoutes(router, {
  requireAuth,
  express,
  paymentLimiter,
  rejectIfNotBuyer,
  getDb,
  fail,
  ORDER_NOT_FOUND,
  FORBIDDEN,
  ORDER_ALREADY_CANCELLED,
  ORDER_NOT_CANCELLABLE,
  ok,
  formatItem,
  sendOrderStatusUpdateEmailBestEffort,
  startPaymentForOrder,
  ORDER_NOT_PAYABLE,
  getSystemCurrency,
  assertSupportedCurrency,
  CURRENCY_MISMATCH,
  normalizeOrderPaymentPayload,
});

registerOrderCreateRoutes(router, {
  requireAuth,
  requireBuyer,
  express,
  orderCreateLimiter,
  orderSpamGuard,
  isBuyer,
  fail,
  FORBIDDEN,
  rejectIfNotBuyer,
  VALIDATION_ERROR,
  getDb,
  assertOrderItemSnapshotSchema,
  reserveInventoryForLine,
  randomUUID,
  buildOrderItemInsertPayload,
  ok,
  formatOrder,
  formatItem,
  sendOrderConfirmationEmailBestEffort,
  PRODUCT_NOT_FOUND,
  OUT_OF_STOCK,
  getSystemCurrency,
  assertSupportedCurrency,
  CURRENCY_MISMATCH,
  normalizeCreateOrderPayload,
  validateCreateOrderPayload,
  normalizeOrderPaymentPayload,
  logLegacyContractUse,
});

module.exports = router;
module.exports.__test = {
  isVariantEffectivelySellable,
  normalizeVariantEconomicsForCheckout,
  buildOrderItemInsertPayload,
  decrementInventorySkuStock,
  reserveInventoryForLine,
};
