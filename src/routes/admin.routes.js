const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { requireAuth } = require("../core/http/auth.middleware");
const { requirePolicy } = require("../core/http/policy.middleware");
const { listFlags } = require("../utils/abuseFlags");
const { listAdminLeads } = require("../services/lead.service");
const { toAbsolutePublicUrl } = require("../utils/publicUrl");
const { sendEmailByTemplate } = require("../services/email.service");
const { buildPublicAppUrl } = require("../services/appPublicUrl.service");
const { registerAdminDashboardRoutes } = require("./admin/dashboard.routes");
const { registerAdminSeedRoutes } = require("./admin/seed.routes");
const { registerAdminOrderRoutes } = require("./admin/orders.routes");
const { registerAdminPaymentRoutes } = require("./admin/payments.routes");

const { ensureAdmin } = require("./admin/shared/ensureAdmin");
const { formatDashboardSummary } = require("./admin/dashboard.helpers");
const {
  REGISTER_TEST_SEED_ROUTES,
  TEST_SEEDS_ENABLED,
  TEST_BUYER_ID,
  MAX_SEEDED_ORDERS,
  ensureArtistForSeed,
  ensureProductVariantForSeed,
} = require("./admin/seed.helpers");
const {
  ORDER_NOT_FOUND,
  ORDER_NOT_FULFILLABLE,
  ORDER_NOT_PAID,
  ORDER_NOT_REFUNDABLE,
  formatItem,
  formatOrder,
  formatEvent,
  sendShipmentDispatchedEmailBestEffort,
  sendOrderStatusUpdateEmailBestEffort,
} = require("./admin/orders.helpers");

const { registerAdminDashboardRoutes } = require("./admin/dashboard.routes");
const { registerAdminSeedRoutes } = require("./admin/seed.routes");
const { registerAdminOrderRoutes } = require("./admin/orders.routes");
const { registerAdminPaymentRoutes } = require("./admin/payments.routes");
const { registerAdminArtistRoutes, __test: adminArtistRoutesTest } = require("./admin/artist/routes");

const FORBIDDEN = { error: "forbidden" };
const ORDER_NOT_FOUND = { error: "order_not_found" };
const ORDER_NOT_FULFILLABLE = { error: "order_not_fulfillable" };
const ORDER_NOT_PAID = { error: "order_not_paid" };
const PAYMENT_NOT_FOUND = { error: "payment_not_found" };
const ORDER_NOT_REFUNDABLE = { error: "order_not_refundable" };
const ORDER_DEFAULT_VIEW_PATH = "/fan/orders";

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

const formatOrder = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    buyerUserId: row.buyer_user_id,
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

const resolveOrderBuyerEmail = async ({ db, buyerUserId }) => {
  const safeBuyerUserId = String(buyerUserId || "").trim();
  if (!safeBuyerUserId) return "";
  const row = await db("users").where({ id: safeBuyerUserId }).first("email");
  return String(row?.email || "").trim().toLowerCase();
};

const buildOrderViewUrl = (orderId) => {
  const safeOrderId = String(orderId || "").trim();
  if (!safeOrderId) return buildPublicAppUrl({ path: ORDER_DEFAULT_VIEW_PATH });
  return (
    buildPublicAppUrl({ path: `${ORDER_DEFAULT_VIEW_PATH}/${safeOrderId}` }) ||
    buildPublicAppUrl({ path: ORDER_DEFAULT_VIEW_PATH })
  );
};

const sendOrderStatusUpdateEmailBestEffort = async ({
  db,
  orderId,
  buyerUserId,
  status,
  message,
}) => {
  try {
    const safeOrderId = String(orderId || "").trim();
    const safeStatus = String(status || "").trim().toLowerCase();
    if (!safeOrderId || !safeStatus) return;

    const recipientEmail = await resolveOrderBuyerEmail({ db, buyerUserId });
    if (!recipientEmail) return;

    const result = await sendEmailByTemplate({
      templateKey: "order-status-update",
      to: recipientEmail,
      payload: {
        orderId: safeOrderId,
        status: safeStatus,
        message: String(message || "").trim(),
        orderUrl: buildOrderViewUrl(safeOrderId),
      },
      metadata: {
        flow: "order_status_update",
        orderId: safeOrderId,
        status: safeStatus,
      },
    });

    if (result.errorCode && !result.skipped) {
      console.warn("[admin.orders.email] status update failed", {
        orderId: safeOrderId,
        status: safeStatus,
        code: result.errorCode,
      });
    }
  } catch (err) {
    console.warn("[admin.orders.email] status update failed", err?.code || err?.message || err);
  }
};

const sendShipmentDispatchedEmailBestEffort = async ({
  db,
  orderId,
  buyerUserId,
  carrier,
  trackingNumber,
  trackingUrl,
}) => {
  try {
    const safeOrderId = String(orderId || "").trim();
    if (!safeOrderId) return;

    const recipientEmail = await resolveOrderBuyerEmail({ db, buyerUserId });
    if (!recipientEmail) return;

    const result = await sendEmailByTemplate({
      templateKey: "shipment-dispatched",
      to: recipientEmail,
      payload: {
        orderId: safeOrderId,
        carrier: String(carrier || "").trim(),
        trackingNumber: String(trackingNumber || "").trim(),
        trackingUrl: String(trackingUrl || "").trim(),
        orderUrl: buildOrderViewUrl(safeOrderId),
      },
      metadata: {
        flow: "shipment_dispatched",
        orderId: safeOrderId,
      },
    });

    if (result.errorCode && !result.skipped) {
      console.warn("[admin.orders.email] shipment dispatched failed", {
        orderId: safeOrderId,
        code: result.errorCode,
      });
    }
  } catch (err) {
    console.warn(
      "[admin.orders.email] shipment dispatched failed",
      err?.code || err?.message || err
    );
  }
};

const ensureAdmin = (req, res) => {
  if (req.user?.role !== "admin") {
    res.status(403).json(FORBIDDEN);
    return false;
  }
  return true;
};

const LINK_POLICY = requirePolicy("admin:ownership:write", "system");

const sortMappingsDeterministically = (rows = []) =>
  rows
    .filter(Boolean)
    .slice()
    .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));

const readArtistUserMappings = async (db, userId) =>
  sortMappingsDeterministically(
    await db("artist_user_map")
      .where({ user_id: userId })
      .select("id", "artist_id", "user_id")
  );

const deleteArtistUserMappingsByIds = async (db, ids = []) => {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedIds.length === 0) return 0;
  return db("artist_user_map").whereIn("id", normalizedIds).delete();
};

const insertArtistUserMapping = async (db, { artistId, userId }) => {
  const mappingId = randomUUID();
  try {
    await db("artist_user_map").insert({
      id: mappingId,
      user_id: userId,
      artist_id: artistId,
    });
    return { inserted: true, mappingId };
  } catch (err) {
    if (err?.code === "23505") {
      return { inserted: false, mappingId: null };
    }
    throw err;
  }
};

const reconcileArtistUserMapping = async ({ db, artistId, userId }) => {
  if (!db || !artistId || !userId) {
    throw new Error("invalid_mapping_input");
  }

  const run = async (trx) => {
    const existingRows = await readArtistUserMappings(trx, userId);
    const sameArtistRows = existingRows.filter((row) => row.artist_id === artistId);

    if (sameArtistRows.length > 0) {
      const keeper = sameArtistRows[0];
      const staleIds = existingRows
        .filter((row) => String(row?.id || "") !== String(keeper.id || ""))
        .map((row) => row.id);
      await deleteArtistUserMappingsByIds(trx, staleIds);
      return {
        idempotent: staleIds.length === 0,
        linked: true,
      };
    }

    if (existingRows.length > 0) {
      await deleteArtistUserMappingsByIds(
        trx,
        existingRows.map((row) => row.id)
      );
    }

    await insertArtistUserMapping(trx, { artistId, userId });

    const afterRows = await readArtistUserMappings(trx, userId);
    const targetRows = afterRows.filter((row) => row.artist_id === artistId);
    if (targetRows.length === 0) {
      const fallback = afterRows[0];
      if (fallback) {
        await deleteArtistUserMappingsByIds(
          trx,
          afterRows
            .filter((row) => String(row?.id || "") !== String(fallback.id || ""))
            .map((row) => row.id)
        );
        try {
          await trx("artist_user_map")
            .where({ id: fallback.id })
            .update({ artist_id: artistId });
        } catch (err) {
          if (err?.code !== "23505") throw err;
        }
      } else {
        await insertArtistUserMapping(trx, { artistId, userId });
      }
    }

    const finalRows = await readArtistUserMappings(trx, userId);
    const finalTargetRows = finalRows.filter((row) => row.artist_id === artistId);
    if (finalTargetRows.length === 0) {
      throw new Error("artist_user_map_reconcile_failed");
    }

    const finalKeeper = finalTargetRows[0];
    const staleIds = finalRows
      .filter((row) => String(row?.id || "") !== String(finalKeeper.id || ""))
      .map((row) => row.id);
    await deleteArtistUserMappingsByIds(trx, staleIds);

    return {
      idempotent: false,
      linked: true,
    };
  };

  if (typeof db.transaction === "function") {
    return db.transaction(async (trx) => run(trx));
  }
  return run(db);
};

const handleLinkArtistUser = async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const { artistId } = req.params;
    const rawUserId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    const rawEmail =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : typeof req.body?.userEmail === "string"
        ? req.body.userEmail.trim().toLowerCase()
        : "";

    if (!artistId || (!rawUserId && !rawEmail)) {
      return res.status(400).json({ error: "invalid_request" });
    }
    const [artist] = await db("artists").where({ id: artistId }).select("id");
    if (!artist) {
      return res.status(404).json({ error: "artist_not_found" });
    }

    let user = null;
    if (rawUserId) {
      [user] = await db("users").where({ id: rawUserId }).select("id", "role");
    }
    if (!user && rawEmail) {
      [user] = await db("users")
        .whereRaw("lower(email) = ?", [rawEmail])
        .select("id", "role");
    }
    if (!user && !rawEmail && rawUserId.includes("@")) {
      [user] = await db("users")
        .whereRaw("lower(email) = ?", [rawUserId.toLowerCase()])
        .select("id", "role");
    }

    if (!user) {
      return res.status(404).json({ error: "user_not_found" });
    }
    if (user.role !== "artist") {
      return res.status(400).json({ error: "user_not_artist" });
    }
    await reconcileArtistUserMapping({
      db,
      artistId,
      userId: user.id,
    });
    res.json({ ok: true, userId: user.id, artistId });
  } catch (err) {
    next(err);
  }
};

const formatDashboardSummary = async (db) => {
  const statusRows = await db("orders")
    .select("status")
    .count("id as count")
    .groupBy("status");

  const orders = {
    placed: 0,
    cancelled: 0,
    fulfilled: 0,
    total: 0,
  };
  for (const row of statusRows) {
    const status = row.status;
    if (orders.hasOwnProperty(status)) {
      orders[status] = Number(row.count);
    }
    orders.total += Number(row.count);
  }

  if (!orders.total) {
    const [{ total = 0 } = {}] = await db("orders").count("id as total");
    orders.total = Number(total);
  }

  const [{ gmvCents = 0 } = {}] = await db("orders")
    .where({ status: "fulfilled" })
    .sum("total_cents as gmvCents");

  const [{ buyersTotal = 0 } = {}] = await db("orders")
    .countDistinct("buyer_user_id as buyersTotal");

  const last7Rows = await db("orders")
    .select(
      db.raw("to_char(created_at::date, 'YYYY-MM-DD') as day"),
      db.raw("count(id) filter (where status = 'fulfilled') as fulfilledCount"),
      db.raw("coalesce(sum(total_cents) filter (where status = 'fulfilled'), 0) as gmvCents")
    )
    .where("created_at", ">=", db.raw("current_date - interval '6 days'"))
    .andWhere("status", "fulfilled")
    .groupBy("day")
    .orderBy("day", "desc");

  const dayMap = new Map();
  for (const row of last7Rows) {
    dayMap.set(row.day, {
      day: row.day,
      fulfilledCount: Number(row.fulfilledcount ?? row.fulfilledCount ?? 0),
      gmvCents: Number(row.gmvcents ?? row.gmvCents ?? 0),
    });
  }

  const last7Days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const day = date.toISOString().slice(0, 10);
    const existing = dayMap.get(day);
    last7Days.push(
      existing || {
        day,
        fulfilledCount: 0,
        gmvCents: 0,
      }
    );
  }

  return {
    orders,
    gmvCents: Number(gmvCents),
    buyers: { total: Number(buyersTotal) },
    last7Days,
  };
};

const NODE_ENV = String(process.env.NODE_ENV || "").trim().toLowerCase();
const IS_TEST_OR_DEV = NODE_ENV === "test" || NODE_ENV === "development";
const TEST_SEEDS_ENABLED = process.env.ENABLE_TEST_SEEDS === "true";
const REGISTER_TEST_SEED_ROUTES = IS_TEST_OR_DEV && TEST_SEEDS_ENABLED;
const TEST_BUYER_ID = "00000000-0000-0000-0000-000000000002";
const MAX_SEEDED_ORDERS = 250;

const ensureArtistForSeed = async (db) => {
  let artist = await db("artists").first();
  if (!artist) {
    const id = randomUUID();
    await db("artists").insert({
      id,
      handle: `seed-artist-${id.slice(0, 8)}`,
      name: "Seed Artist",
      theme_json: {},
    });
    artist = { id };
  }
  return artist;
};

const ensureProductVariantForSeed = async (db, artistId, minStock) => {
  let product = await db("products").where({ artist_id: artistId }).first();
  if (!product) {
    const productId = await createProductWithVariants({
      artistId,
      title: "Seed Smoke Product",
      description: "Auto-generated for admin smoke",
      isActive: true,
      variants: [
        {
          sku: `SMOKE-${Date.now()}`,
          size: "OS",
          color: "Black",
          priceCents: 4200,
          stock: minStock,
        },
      ],
    });
    product = { id: productId };
  }
  let variant = await db("product_variants")
    .where({ product_id: product.id })
    .first();
  if (!variant) {
    const [skuRow] = await db("inventory_skus")
      .insert({
        id: randomUUID(),
        supplier_sku: `SMOKE-SKU-${Date.now()}`,
        merch_type: "default",
        quality_tier: null,
        size: "OS",
        color: "Black",
        stock: minStock,
        is_active: true,
        metadata: db.raw("?::jsonb", [JSON.stringify({ source: "admin.seed_orders" })]),
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning(["id"]);
    const variantId = randomUUID();
    await db("product_variants").insert({
      id: variantId,
      product_id: product.id,
      inventory_sku_id: skuRow?.id || null,
      sku: `SMOKE-${Date.now()}`,
      size: "OS",
      color: "Black",
      price_cents: 4200,
      selling_price_cents: 4200,
      is_listed: true,
      stock: minStock,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    variant = await db("product_variants")
      .where({ id: variantId })
      .first();
  }
  const inventorySkuId = variant.inventory_sku_id;
  if (!inventorySkuId) {
    throw new Error("seed_variant_missing_inventory_sku");
  }
  const skuRow = await db("inventory_skus").where({ id: inventorySkuId }).first();
  const desiredStock = Math.max(minStock, Number(skuRow?.stock ?? 0));
  await db("inventory_skus")
    .where({ id: inventorySkuId })
    .update({
      stock: desiredStock + 10,
      is_active: true,
      updated_at: db.fn.now(),
    });
  variant = await db("product_variants").where({ id: variant.id }).first();
  return variant;
};

const router = express.Router();
const PAYMENT_NOT_FOUND = { error: "payment_not_found" };

registerAdminDashboardRoutes(router, {
  requireAuth,
  requirePolicy,
  ensureAdmin,
  listAdminLeads,
  getDb,
  formatDashboardSummary,
});

registerAdminSeedRoutes(router, {
  REGISTER_TEST_SEED_ROUTES,
  requireAuth,
  express,
  TEST_SEEDS_ENABLED,
  ensureAdmin,
  MAX_SEEDED_ORDERS,
  getDb,
  ensureArtistForSeed,
  ensureProductVariantForSeed,
  randomUUID,
  TEST_BUYER_ID,
});

registerAdminOrderRoutes(router, {
  requireAuth,
  requirePolicy,
  ensureAdmin,
  getDb,
  formatOrder,
  formatItem,
  formatEvent,
  ORDER_NOT_FOUND,
  ORDER_NOT_FULFILLABLE,
  ORDER_NOT_PAID,
  ORDER_NOT_REFUNDABLE,
  sendShipmentDispatchedEmailBestEffort,
  sendOrderStatusUpdateEmailBestEffort,
});

registerAdminPaymentRoutes(router, {
  requireAuth,
  ensureAdmin,
  getDb,
  PAYMENT_NOT_FOUND,
  listFlags,
});

router.post(
  "/artists/:artistId/link-user",
  requireAuth,
  requirePolicy,
  ensureAdmin,
  getDb,
  formatOrder,
  formatItem,
  formatEvent,
  ORDER_NOT_FOUND,
  ORDER_NOT_FULFILLABLE,
  ORDER_NOT_PAID,
  ORDER_NOT_REFUNDABLE,
  sendShipmentDispatchedEmailBestEffort,
  sendOrderStatusUpdateEmailBestEffort,
});

registerAdminPaymentRoutes(router, {
  requireAuth,
  ensureAdmin,
  getDb,
  PAYMENT_NOT_FOUND,
  listFlags,
});

registerAdminArtistRoutes(router, {
  ensureAdmin,
});

module.exports = router;
module.exports.__test = {
  fetchActiveArtistSubscriptionPayload: adminArtistRoutesTest.fetchActiveArtistSubscriptionPayload,
  updateArtistSubscriptionAction: adminArtistRoutesTest.updateArtistSubscriptionAction,
  reconcileArtistUserMapping: adminArtistRoutesTest.reconcileArtistUserMapping,
};
