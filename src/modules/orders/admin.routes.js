const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const { listFlags } = require("../../utils/abuseFlags");
const { createProductWithVariants } = require("../../modules/catalog/catalog.service");

const router = express.Router();

const FORBIDDEN = { error: "forbidden" };
const ORDER_NOT_FOUND = { error: "order_not_found" };
const ORDER_NOT_FULFILLABLE = { error: "order_not_fulfillable" };
const NOT_IMPLEMENTED = { error: "not_implemented" };
const ORDER_NOT_PAID = { error: "order_not_paid" };
const PAYMENT_NOT_FOUND = { error: "payment_not_found" };
const ORDER_NOT_REFUNDABLE = { error: "order_not_refundable" };

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

const ensureAdmin = (req, res) => {
  if (req.user?.role !== "admin") {
    res.status(403).json(FORBIDDEN);
    return false;
  }
  return true;
};

const LINK_POLICY = requirePolicy("admin:ownership:write", "system");

const handleLinkArtistUser = async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const { artistId } = req.params;
    const { userId } = req.body || {};
    if (!artistId || !userId) {
      return res.status(400).json({ error: "invalid_request" });
    }
    const [artist] = await db("artists").where({ id: artistId }).select("id");
    if (!artist) {
      return res.status(404).json({ error: "artist_not_found" });
    }
    const [user] = await db("users").where({ id: userId }).select("id", "role");
    if (!user) {
      return res.status(404).json({ error: "user_not_found" });
    }
    if (user.role !== "artist") {
      return res.status(400).json({ error: "user_not_artist" });
    }
    const existing = await db("artist_user_map").where({ user_id: userId }).first();
    if (existing) {
      await db("artist_user_map")
        .where({ user_id: userId })
        .update({ artist_id: artistId });
    } else {
      await db("artist_user_map").insert({
        user_id: userId,
        artist_id: artistId,
      });
    }
    res.json({ ok: true, userId, artistId });
  } catch (err) {
    next(err);
  }
};

const handleAdminSummary = async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const summary = await formatDashboardSummary(db);
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

router.get(
  "/dashboard/summary",
  requireAuth,
  requirePolicy("admin_dashboard:read", "self"),
  handleAdminSummary
);

router.get(
  "/metrics",
  requireAuth,
  requirePolicy("admin_dashboard:read", "self"),
  handleAdminSummary
);

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

const TEST_SEEDS_ENABLED =
  process.env.ENABLE_TEST_SEEDS === "true" ||
  process.env.NODE_ENV !== "production";
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
    const variantId = randomUUID();
    await db("product_variants").insert({
      id: variantId,
      product_id: product.id,
      sku: `SMOKE-${Date.now()}`,
      size: "OS",
      color: "Black",
      price_cents: 4200,
      stock: minStock,
      created_at: db.fn.now(),
    });
    variant = await db("product_variants")
      .where({ id: variantId })
      .first();
  }
  const desiredStock = Math.max(minStock, variant.stock ?? 0);
  await db("product_variants")
    .where({ id: variant.id })
    .update({ stock: desiredStock + 10 });
  return variant;
};

router.post(
  "/test/seed-orders",
  requireAuth,
  express.json(),
  async (req, res, next) => {
    if (!TEST_SEEDS_ENABLED) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!ensureAdmin(req, res)) return;
    try {
      const body = req.body || {};
      const requestedPlaced = Number(body.placedCount ?? 15);
      const requestedPaid = Number(body.paidCount ?? 0);
      const placedCount = Math.min(
        Math.max(requestedPlaced, 1),
        MAX_SEEDED_ORDERS
      );
      const paidCount = Math.min(
        Math.max(requestedPaid, 0),
        placedCount
      );
      const db = getDb();
      const artist = await ensureArtistForSeed(db);
      const variant = await ensureProductVariantForSeed(
        db,
        artist.id,
        placedCount + paidCount + 5
      );
      const createdOrderIds = [];
      for (let idx = 0; idx < placedCount; idx += 1) {
        const orderId = randomUUID();
        const now = db.fn.now();
        await db.transaction(async (trx) => {
          await trx("orders").insert({
            id: orderId,
            buyer_user_id: TEST_BUYER_ID,
            status: "placed",
            total_cents: variant.price_cents,
            created_at: now,
            updated_at: now,
          });
          await trx("product_variants")
            .where({ id: variant.id })
            .decrement("stock", 1);
          await trx("payments").insert({
            id: randomUUID(),
            order_id: orderId,
            status: idx < paidCount ? "paid" : "unpaid",
            provider: "mock",
            amount_cents: variant.price_cents,
            currency: "USD",
            created_at: now,
            updated_at: now,
          });
          await trx("order_items").insert({
            id: randomUUID(),
            order_id: orderId,
            product_id: variant.product_id,
            product_variant_id: variant.id,
            quantity: 1,
            price_cents: variant.price_cents,
            created_at: now,
          });
          await trx("order_events").insert({
            id: randomUUID(),
            order_id: orderId,
            type: "placed",
            actor_user_id: req.user.id,
            created_at: now,
          });
        });
        createdOrderIds.push(orderId);
      }
      return res.json({
        createdPlaced: placedCount,
        createdPaid: paidCount,
        sampleOrderIds: createdOrderIds.slice(0, 5),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/dashboard/orders",
  requireAuth,
  requirePolicy("admin_dashboard:read", "self"),
  async (req, res, next) => {
    try {
      if (!ensureAdmin(req, res)) return;
      const db = getDb();
      const rows = await db("orders")
        .leftJoin("order_items", "order_items.order_id", "orders.id")
        .select(
          "orders.id as orderId",
          "orders.status as status",
          "orders.total_cents as totalCents",
          "orders.created_at as createdAt",
          "orders.buyer_user_id as buyerUserId",
          db.raw("COUNT(order_items.id) as itemsCount")
        )
        .groupBy(
          "orders.id",
          "orders.status",
          "orders.total_cents",
          "orders.created_at",
          "orders.buyer_user_id"
        )
        .orderBy("orders.created_at", "desc")
        .limit(50);

      const items = rows.map((row) => ({
        orderId: row.orderId,
        status: row.status,
        totalCents: Number(row.totalCents ?? 0),
        createdAt: row.createdAt
          ? new Date(row.createdAt).toISOString()
          : null,
        buyerUserId: row.buyerUserId,
        itemsCount: Number(row.itemsCount ?? 0),
      }));

      res.json({ items });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/orders", requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const hasLimitOffset =
      typeof req.query.limit !== "undefined" ||
      typeof req.query.offset !== "undefined";

    const toInt = (value, fallback) => {
      const parsed = Number.parseInt(String(value ?? ""), 10);
      return Number.isNaN(parsed) ? fallback : parsed;
    };

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    let page = 1;
    let pageSize = 25;
    let offset = 0;

    if (hasLimitOffset) {
      const limitRaw = toInt(req.query.limit, 25);
      const offsetRaw = toInt(req.query.offset, 0);
      pageSize = clamp(limitRaw, 1, 100);
      offset = Math.max(offsetRaw, 0);
      page = Math.floor(offset / pageSize) + 1;
    } else {
      const pageRaw = toInt(req.query.page, 1);
      const pageSizeRaw = toInt(req.query.pageSize, 25);
      page = Math.max(pageRaw, 1);
      pageSize = clamp(pageSizeRaw, 1, 100);
      offset = (page - 1) * pageSize;
    }

    const baseQuery = db("orders");

    const totalRow = await baseQuery
      .clone()
      .clearSelect()
      .clearOrder()
      .count({ count: "*" })
      .first();
    const total = Number(
      totalRow?.count ??
        totalRow?.["count(*)"] ??
        totalRow?.["count"] ??
        totalRow?.["COUNT(*)"] ??
        0
    );
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const orders = await baseQuery
      .clone()
      .select("id", "status", "total_cents", "created_at", "buyer_user_id")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(pageSize)
      .offset(offset);

    const orderIds = orders.map((order) => order.id);
    let counts = [];
    if (orderIds.length) {
      counts = await db("order_items")
        .whereIn("order_id", orderIds)
        .groupBy("order_id")
        .select("order_id")
        .count("id as itemsCount");
    }

    const countMap = counts.reduce((acc, row) => {
      acc[row.order_id] = Number(row.itemsCount);
      return acc;
    }, {});

    res.json({
      items: orders.map((order) => ({
        ...formatOrder(order),
        itemsCount: countMap[order.id] || 0,
      })),
      page: {
        total,
        limit: pageSize,
        offset,
        totalPages,
      },
      total,
      totalPages,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/orders/:id", requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const order = await db("orders").where({ id: req.params.id }).first();
    if (!order) {
      return res.status(404).json(ORDER_NOT_FOUND);
    }
    const items = await db("order_items").where({ order_id: order.id }).select();
    const payment = await db("payments")
      .where({ order_id: order.id })
      .select("id", "status", "provider")
      .first();
    res.json({
      ...formatOrder(order),
      items: items.map(formatItem),
      payment: payment
        ? {
            paymentId: payment.id,
            status: payment.status,
            provider: payment.provider,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/orders/:id/events", requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const order = await db("orders").where({ id: req.params.id }).first();
    if (!order) {
      return res.status(404).json(ORDER_NOT_FOUND);
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

  router.post("/orders/:id/fulfill", requireAuth, async (req, res, next) => {
    try {
      if (!ensureAdmin(req, res)) return;
      const db = getDb();
      const orderId = req.params.id;
      const order = await db("orders").where({ id: orderId }).first();
      if (!order) {
        return res.status(404).json(ORDER_NOT_FOUND);
      }
      if (order.status !== "placed") {
        return res.status(400).json(ORDER_NOT_FULFILLABLE);
      }
      const payment = await db("payments")
        .where({ order_id: orderId })
        .orderBy("created_at", "desc")
        .first();
      if (!payment || payment.status !== "paid") {
        return res.status(400).json(ORDER_NOT_PAID);
      }

      const result = await db.transaction(async (trx) => {
        const now = trx.fn.now();
      await trx("orders").where({ id: orderId }).update({
        status: "fulfilled",
        updated_at: now,
      });
      const items = await trx("order_items").where({ order_id: orderId }).select();
      await trx("order_events").insert({
        order_id: orderId,
        type: "fulfilled",
        actor_user_id: req.user.id,
      });
      const updatedOrder = await trx("orders").where({ id: orderId }).first();
      return { order: updatedOrder, items };
    });

    res.json({
      ...formatOrder(result.order),
      items: result.items.map(formatItem),
    });
  } catch (err) {
    next(err);
    }
  });

router.post("/orders/:id/refund", requireAuth, async (req, res, next) => {
    try {
      if (!ensureAdmin(req, res)) return;
      const db = getDb();
      const orderId = req.params.id;
      const order = await db("orders").where({ id: orderId }).first();
      if (!order) {
        return res.status(404).json(ORDER_NOT_FOUND);
      }
      const payment = await db("payments")
        .where({ order_id: orderId })
        .orderBy("created_at", "desc")
        .first();
      if (!payment || payment.status !== "paid") {
        return res.status(400).json(ORDER_NOT_REFUNDABLE);
      }
      await db("payments").where({ id: payment.id }).update({
        status: "refunded",
        updated_at: db.fn.now(),
      });
      return res.json({ ok: true, status: "refunded" });
    } catch (err) {
      next(err);
    }
});

router.get("/payments", requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const status = req.query.status;
    let limit = parseInt(req.query.limit, 10);
    let offset = parseInt(req.query.offset, 10);
    if (Number.isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 200) limit = 200;
    if (Number.isNaN(offset) || offset < 0) offset = 0;

    const query = db("payments").select(
      "id",
      "order_id",
      "status",
      "provider",
      "amount_cents",
      "currency",
      "provider_order_id",
      "provider_payment_id",
      "paid_at",
      "created_at",
      "updated_at"
    );
    if (status) {
      query.where({ status });
    }
    const payments = await query.orderBy("created_at", "desc").limit(limit).offset(offset);

    res.json({
      items: payments.map((row) => ({
        paymentId: row.id,
        orderId: row.order_id,
        status: row.status,
        provider: row.provider,
        amountCents: row.amount_cents,
        currency: row.currency,
        providerOrderId: row.provider_order_id,
        providerPaymentId: row.provider_payment_id,
        paidAt: row.paid_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/payments/:paymentId/events", requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const paymentId = req.params.paymentId;
    if (!paymentId) {
      return res.status(404).json(PAYMENT_NOT_FOUND);
    }
    const payment = await db("payments").where({ id: paymentId }).first();
    if (!payment) {
      return res.status(404).json(PAYMENT_NOT_FOUND);
    }
    const events = await db("payment_events")
      .where({ payment_id: paymentId })
      .orderBy("created_at", "asc")
      .select(
        "id",
        "event_type",
        "provider",
        "provider_event_id",
        "created_at",
        "payload_json"
      );
    res.json({
      items: events.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        provider: row.provider,
        providerEventId: row.provider_event_id,
        createdAt: row.created_at,
        payload: row.payload_json,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/abuse-flags", requireAuth, async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    res.json({
      items: listFlags(),
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/artists/:artistId/link-user",
  requireAuth,
  LINK_POLICY,
  express.json(),
  handleLinkArtistUser
);

module.exports = router;
