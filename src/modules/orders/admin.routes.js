const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const { listFlags } = require("../../utils/abuseFlags");
const { createProductWithVariants } = require("../../modules/catalog/catalog.service");
const { toAbsolutePublicUrl } = require("../../utils/publicUrl");

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
    const existing = await db("artist_user_map").where({ user_id: user.id }).first();
    if (existing) {
      await db("artist_user_map")
        .where({ user_id: user.id })
        .update({ artist_id: artistId });
    } else {
      await db("artist_user_map").insert({
        id: randomUUID(),
        user_id: user.id,
        artist_id: artistId,
      });
    }
    res.json({ ok: true, userId: user.id, artistId });
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
      await db.transaction(async (trx) => {
        const now = trx.fn.now();
        await trx("payments").where({ id: payment.id }).update({
          status: "refunded",
          updated_at: now,
        });
        const existingRefundedEvent = await trx("order_events")
          .where({ order_id: orderId, type: "refunded" })
          .first("id");
        if (!existingRefundedEvent) {
          await trx("order_events").insert({
            order_id: orderId,
            type: "refunded",
            actor_user_id: req.user.id,
            created_at: now,
          });
        }
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

const toIsoOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const normalizeRequestStatus = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "denied") return "rejected";
  return normalized || "pending";
};

const ARTIST_STATUS_OPTIONS = [
  "approved",
  "active",
  "inactive",
  "rejected",
  "onboarded",
  "pending",
];

const normalizeArtistStatusInput = (status) => {
  const normalized = normalizeRequestStatus(status);
  return ARTIST_STATUS_OPTIONS.includes(normalized) ? normalized : "";
};

const buildArtistStatus = (requestStatus, linkedUsersCount) => {
  const normalized = normalizeRequestStatus(requestStatus);
  if (normalized === "approved") return "approved";
  if (normalized === "rejected" || normalized === "denied") return "rejected";
  if (linkedUsersCount > 0) return "active";
  return "onboarded";
};

const normalizeEmailOrNull = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  return text || null;
};

const normalizeSocialRows = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const platform = String(entry?.platform ?? entry?.name ?? "").trim();
        const resolvedValue = String(
          entry?.value ??
            entry?.profileLink ??
            entry?.url ??
            entry?.link ??
            entry?.handle ??
            ""
        ).trim();
        if (!platform && !resolvedValue) return null;
        return {
          platform,
          value: resolvedValue,
          profileLink: resolvedValue,
        };
      })
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([platform, resolvedValue]) => {
        const platformText = String(platform ?? "").trim();
        const valueText = String(resolvedValue ?? "").trim();
        if (!platformText && !valueText) return null;
        return {
          platform: platformText,
          value: valueText,
          profileLink: valueText,
        };
      })
      .filter(Boolean);
  }
  return [];
};

const fetchAdminArtistDetailPayload = async (db, artistId) => {
  const hasArtistsTable = await db.schema.hasTable("artists");
  if (!hasArtistsTable) {
    return {
      statusCode: 404,
      body: { error: "not_found", message: "Artist not found" },
    };
  }

  const artistColumns = await db("artists").columnInfo();
  const artist = await db("artists").where({ id: artistId }).first();
  if (!artist) {
    return {
      statusCode: 404,
      body: { error: "not_found", message: "Artist not found" },
    };
  }

  let email = null;
  const hasArtistUserMap = await db.schema.hasTable("artist_user_map");
  const hasUsersTable = await db.schema.hasTable("users");
  if (hasArtistUserMap && hasUsersTable) {
    const linkedUser = await db("artist_user_map as aum")
      .leftJoin("users as u", "u.id", "aum.user_id")
      .where("aum.artist_id", artistId)
      .select("u.email")
      .first();
    email = normalizeEmailOrNull(linkedUser?.email);
  }

  if (
    !email &&
    hasUsersTable &&
    Object.prototype.hasOwnProperty.call(artistColumns, "user_id") &&
    artist?.user_id
  ) {
    const linkedUser = await db("users")
      .where({ id: artist.user_id })
      .select("email")
      .first();
    email = normalizeEmailOrNull(linkedUser?.email);
  }

  let latestApprovedRequest = null;
  const hasRequestsTable = await db.schema.hasTable("artist_access_requests");
  if (hasRequestsTable) {
    const requestColumns = await db("artist_access_requests").columnInfo();
    const requestQuery = db("artist_access_requests").where("status", "approved");
    if (Object.prototype.hasOwnProperty.call(requestColumns, "handle") && artist.handle) {
      requestQuery.whereRaw("lower(trim(handle)) = lower(trim(?))", [artist.handle]);
    } else if (Object.prototype.hasOwnProperty.call(requestColumns, "email") && email) {
      requestQuery.whereRaw("lower(trim(email)) = lower(trim(?))", [email]);
    }
    latestApprovedRequest = await requestQuery.orderBy("created_at", "desc").first();
  }

  let profilePhotoUrl = "";
  const hasEntityMediaLinks = await db.schema.hasTable("entity_media_links");
  const hasMediaAssets = await db.schema.hasTable("media_assets");
  if (hasEntityMediaLinks && hasMediaAssets) {
    const mediaRow = await db("entity_media_links as eml")
      .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
      .where("eml.entity_type", "artist")
      .andWhere("eml.role", "profile_photo")
      .andWhere("eml.entity_id", artistId)
      .orderBy("eml.sort_order", "asc")
      .select("ma.public_url")
      .first();
    profilePhotoUrl = toAbsolutePublicUrl(mediaRow?.public_url);
  }
  if (!profilePhotoUrl && Object.prototype.hasOwnProperty.call(artistColumns, "profile_photo_url")) {
    profilePhotoUrl = toAbsolutePublicUrl(artist.profile_photo_url);
  }

  const status =
    String(artist.status ?? latestApprovedRequest?.status ?? "active").trim().toLowerCase() ||
    "active";

  const phone = Object.prototype.hasOwnProperty.call(artistColumns, "phone")
    ? String(artist.phone ?? "").trim()
    : String(latestApprovedRequest?.phone ?? latestApprovedRequest?.contact_phone ?? "").trim();

  const aboutMe = Object.prototype.hasOwnProperty.call(artistColumns, "about_me")
    ? String(artist.about_me ?? "").trim()
    : String(latestApprovedRequest?.about_me ?? latestApprovedRequest?.pitch ?? "").trim();

  const messageForFans = Object.prototype.hasOwnProperty.call(
    artistColumns,
    "message_for_fans"
  )
    ? String(artist.message_for_fans ?? "").trim()
    : String(latestApprovedRequest?.message_for_fans ?? "").trim();

  const socials = Object.prototype.hasOwnProperty.call(artistColumns, "socials")
    ? artist.socials ?? []
    : latestApprovedRequest?.socials ?? [];
  const normalizedSocials = normalizeSocialRows(socials);

  const capabilities = {
    canEditName:
      Object.prototype.hasOwnProperty.call(artistColumns, "name") ||
      Object.prototype.hasOwnProperty.call(artistColumns, "artist_name"),
    canEditHandle: Object.prototype.hasOwnProperty.call(artistColumns, "handle"),
    canEditEmail:
      Object.prototype.hasOwnProperty.call(artistColumns, "email") ||
      (hasArtistUserMap && hasUsersTable),
    canEditStatus: Object.prototype.hasOwnProperty.call(artistColumns, "status"),
    canEditPhone:
      Object.prototype.hasOwnProperty.call(artistColumns, "phone") || hasRequestsTable,
    canEditAboutMe: Object.prototype.hasOwnProperty.call(artistColumns, "about_me"),
    canEditMessageForFans: Object.prototype.hasOwnProperty.call(artistColumns, "message_for_fans"),
    canEditSocials: Object.prototype.hasOwnProperty.call(artistColumns, "socials"),
    canEditProfilePhoto:
      Object.prototype.hasOwnProperty.call(artistColumns, "profile_photo_url") ||
      (hasEntityMediaLinks && hasMediaAssets),
    canUploadProfilePhoto:
      hasMediaAssets &&
      (Object.prototype.hasOwnProperty.call(artistColumns, "profile_photo_url") ||
        hasEntityMediaLinks),
  };

  return {
    statusCode: 200,
    body: {
      id: artist.id,
      name: artist.name ?? artist.artist_name ?? "",
      handle: String(artist.handle ?? "").replace(/^@/, ""),
      status,
      email,
      phone,
      about: aboutMe,
      about_me: aboutMe,
      aboutMe,
      message_for_fans: messageForFans,
      messageForFans,
      socials: normalizedSocials,
      profile_photo_url: profilePhotoUrl,
      profilePhotoUrl,
      statusOptions: ARTIST_STATUS_OPTIONS,
      capabilities,
    },
  };
};

router.get("/artists", requireAuth, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const artistColumns = await db("artists").columnInfo();
    const hasArtistColumn = (name) => Object.prototype.hasOwnProperty.call(artistColumns, name);

    const selectColumns = ["id"];
    if (hasArtistColumn("name")) selectColumns.push("name");
    if (hasArtistColumn("artist_name")) selectColumns.push("artist_name");
    if (hasArtistColumn("handle")) selectColumns.push("handle");
    if (hasArtistColumn("status")) selectColumns.push("status");
    if (hasArtistColumn("email")) selectColumns.push("email");
    if (hasArtistColumn("phone")) selectColumns.push("phone");
    if (hasArtistColumn("created_at")) selectColumns.push("created_at");

    let query = db("artists").select(selectColumns).limit(200);
    if (hasArtistColumn("created_at")) {
      query = query.orderBy("created_at", "desc");
    } else {
      query = query.orderBy("id", "desc");
    }
    const rows = await query;

    const artistIds = rows.map((row) => row.id).filter(Boolean);
    const linkedUsersCountByArtistId = new Map();
    const linkedEmailByArtistId = new Map();
    const normalizeText = (value) => String(value ?? "").trim();
    const normalizeLower = (value) => normalizeText(value).toLowerCase();

    const hasArtistUserMap = await db.schema.hasTable("artist_user_map");
    const hasUsersTable = await db.schema.hasTable("users");
    if (hasArtistUserMap && hasUsersTable && artistIds.length > 0) {
      const linkedRows = await db("artist_user_map as aum")
        .leftJoin("users as u", "u.id", "aum.user_id")
        .whereIn("aum.artist_id", artistIds)
        .select("aum.artist_id as artistId", "aum.user_id as userId", "u.email as userEmail");

      for (const linkedRow of linkedRows) {
        const artistId = linkedRow?.artistId;
        if (!artistId) continue;
        const prevCount = linkedUsersCountByArtistId.get(artistId) || 0;
        if (linkedRow?.userId) {
          linkedUsersCountByArtistId.set(artistId, prevCount + 1);
        } else {
          linkedUsersCountByArtistId.set(artistId, prevCount);
        }

        const email = normalizeText(linkedRow?.userEmail);
        if (email && !linkedEmailByArtistId.has(artistId)) {
          linkedEmailByArtistId.set(artistId, email);
        }
      }
    }

    const requestStatusByArtistId = new Map();
    const requestPhoneByArtistId = new Map();
    const hasRequestsTable = await db.schema.hasTable("artist_access_requests");
    if (hasRequestsTable && artistIds.length > 0) {
      const requestColumns = await db("artist_access_requests").columnInfo();
      const hasRequestColumn = (name) => Object.prototype.hasOwnProperty.call(requestColumns, name);

      const canMatchByHandle = hasRequestColumn("handle");
      const canMatchByEmail = hasRequestColumn("email") || hasRequestColumn("contact_email");
      const canUseStatus = hasRequestColumn("status");
      const hasCreatedAt = hasRequestColumn("created_at");
      const hasPhone = hasRequestColumn("phone") || hasRequestColumn("contact_phone");

      if ((canMatchByHandle || canMatchByEmail) && (canUseStatus || hasPhone)) {
        const selectRequestColumns = [];
        if (canMatchByHandle) selectRequestColumns.push("handle");
        if (hasRequestColumn("email")) selectRequestColumns.push("email");
        if (hasRequestColumn("contact_email")) selectRequestColumns.push("contact_email");
        if (canUseStatus) selectRequestColumns.push("status");
        if (hasRequestColumn("phone")) selectRequestColumns.push("phone");
        if (hasRequestColumn("contact_phone")) selectRequestColumns.push("contact_phone");
        if (hasCreatedAt) selectRequestColumns.push("created_at");

        let requestQuery = db("artist_access_requests").select(selectRequestColumns);
        if (hasCreatedAt) {
          requestQuery = requestQuery.orderBy("created_at", "desc");
        }
        const requestRows = await requestQuery;

        const artistIdsByHandle = new Map();
        const artistIdsByEmail = new Map();
        for (const row of rows) {
          const rowHandle = normalizeLower(row?.handle);
          const rowEmail = normalizeLower(row?.email || linkedEmailByArtistId.get(row?.id));
          if (rowHandle && !artistIdsByHandle.has(rowHandle)) {
            artistIdsByHandle.set(rowHandle, row.id);
          }
          if (rowEmail && !artistIdsByEmail.has(rowEmail)) {
            artistIdsByEmail.set(rowEmail, row.id);
          }
        }

        for (const requestRow of requestRows) {
          let matchedArtistId = null;
          if (canMatchByHandle) {
            const key = normalizeLower(requestRow?.handle);
            if (key && artistIdsByHandle.has(key)) {
              matchedArtistId = artistIdsByHandle.get(key);
            }
          }
          if (!matchedArtistId && canMatchByEmail) {
            const key = normalizeLower(requestRow?.email || requestRow?.contact_email);
            if (key && artistIdsByEmail.has(key)) {
              matchedArtistId = artistIdsByEmail.get(key);
            }
          }
          if (!matchedArtistId) continue;

          if (canUseStatus && !requestStatusByArtistId.has(matchedArtistId)) {
            requestStatusByArtistId.set(
              matchedArtistId,
              normalizeRequestStatus(requestRow?.status)
            );
          }
          if (hasPhone && !requestPhoneByArtistId.has(matchedArtistId)) {
            const phone = normalizeText(requestRow?.phone || requestRow?.contact_phone);
            if (phone) requestPhoneByArtistId.set(matchedArtistId, phone);
          }
        }
      }
    }

    const items = rows.map((r) => ({
      id: r.id,
      name: normalizeText(r.name ?? r.artist_name),
      handle: normalizeText(r.handle),
      status: normalizeText(r.status)
        ? normalizeRequestStatus(r.status)
        : buildArtistStatus(
            requestStatusByArtistId.get(r.id),
            linkedUsersCountByArtistId.get(r.id) || 0
          ),
      email: normalizeText(r.email) || linkedEmailByArtistId.get(r.id) || "",
      phone: normalizeText(r.phone) || requestPhoneByArtistId.get(r.id) || "",
      createdAt: r.created_at ?? null,
    }));

    console.log("[admin artists] ok count=", items.length);
    return res.json({ items, total: rows.length });
  } catch (err) {
    console.error("[admin artists] error", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

router.get("/artists/:id", requireAuth, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const artistId = String(req.params.id || "").trim();
    if (!artistId) {
      return res.status(400).json({ error: "validation_error", message: "artist id is required" });
    }
    const db = getDb();
    const detail = await fetchAdminArtistDetailPayload(db, artistId);
    return res.status(detail.statusCode).json(detail.body);
  } catch (err) {
    console.error("[admin artist detail] error", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

router.patch("/artists/:id", requireAuth, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const artistId = String(req.params.id || "").trim();
    if (!artistId) {
      return res.status(400).json({ error: "validation_error", message: "artist id is required" });
    }

    const payload = req.body || {};
    const db = getDb();
    const artist = await db("artists").where({ id: artistId }).first();
    if (!artist) {
      return res.status(404).json({ error: "not_found", message: "Artist not found" });
    }

    const artistColumns = await db("artists").columnInfo();
    const hasArtistColumn = (name) => Object.prototype.hasOwnProperty.call(artistColumns, name);
    const hasPayloadKey = (key) => Object.prototype.hasOwnProperty.call(payload, key);
    const asText = (value) => String(value ?? "").trim();
    const asNullableText = (value) => {
      const text = asText(value);
      return text ? text : null;
    };
    const validateStringField = (keys, field) => {
      for (const key of keys) {
        if (!hasPayloadKey(key)) continue;
        const value = payload[key];
        if (value == null) continue;
        if (typeof value !== "string") {
          return res.status(400).json({
            error: "validation",
            details: [{ field, message: `${field} must be a string` }],
          });
        }
      }
      return null;
    };

    const stringValidation =
      validateStringField(["name"], "name") ||
      validateStringField(["phone"], "phone") ||
      validateStringField(["about", "about_me", "aboutMe"], "about") ||
      validateStringField(["message_for_fans", "messageForFans"], "message_for_fans") ||
      validateStringField(["profile_photo_url", "profilePhotoUrl"], "profile_photo_url") ||
      validateStringField(["email"], "email");
    if (stringValidation) return stringValidation;

    const patch = {};
    let hasAnyUpdate = false;
    const ignoredFields = [];

    if (hasPayloadKey("name")) {
      if (!(hasArtistColumn("name") || hasArtistColumn("artist_name"))) {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "name", message: "name is not editable on this deployment" }],
        });
      }
      const name = asText(payload.name);
      if (name.length < 2) {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "name", message: "name must be at least 2 characters" }],
        });
      }
      if (hasArtistColumn("name")) patch.name = name;
      if (hasArtistColumn("artist_name")) patch.artist_name = name;
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("handle")) {
      if (!hasArtistColumn("handle")) {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "handle", message: "handle is not editable on this deployment" }],
        });
      }
      const handle = asText(payload.handle).replace(/^@+/, "");
      if (!handle) {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "handle", message: "handle cannot be empty" }],
        });
      }
      const taken = await db("artists")
        .whereRaw("lower(trim(handle)) = lower(trim(?))", [handle])
        .andWhereNot("id", artistId)
        .select("id")
        .first();
      if (taken) {
        return res.status(409).json({
          error: "conflict",
          details: [{ field: "handle", message: "handle is already in use" }],
        });
      }
      patch.handle = handle;
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("status")) {
      if (!hasArtistColumn("status")) {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "status", message: "status is not editable on this deployment" }],
        });
      }
      const status = normalizeArtistStatusInput(payload.status);
      if (!status) {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "status", message: `status must be one of: ${ARTIST_STATUS_OPTIONS.join(", ")}` }],
        });
      }
      patch.status = status;
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("phone") && hasArtistColumn("phone")) {
      patch.phone = asNullableText(payload.phone);
      hasAnyUpdate = true;
    }

    if (
      (hasPayloadKey("about") || hasPayloadKey("about_me") || hasPayloadKey("aboutMe")) &&
      hasArtistColumn("about_me")
    ) {
      patch.about_me = asNullableText(payload.about ?? payload.about_me ?? payload.aboutMe);
      hasAnyUpdate = true;
    }

    if (
      (hasPayloadKey("message_for_fans") || hasPayloadKey("messageForFans")) &&
      hasArtistColumn("message_for_fans")
    ) {
      patch.message_for_fans = asNullableText(
        payload.message_for_fans ?? payload.messageForFans
      );
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("socials") && hasArtistColumn("socials")) {
      const rawSocials = payload.socials;
      const parsedSocials =
        typeof rawSocials === "string"
          ? (() => {
              try {
                return JSON.parse(rawSocials);
              } catch (_err) {
                return null;
              }
            })()
          : rawSocials;
      let normalizedSocials = [];
      if (Array.isArray(parsedSocials)) {
        normalizedSocials = parsedSocials
          .map((entry) => ({
            platform: asText(entry?.platform || entry?.name),
            value: asText(
              entry?.profileLink || entry?.url || entry?.link || entry?.value || entry?.handle
            ),
          }))
          .map((entry) => ({
            platform: entry.platform,
            value: entry.value,
            profileLink: entry.value,
          }))
          .filter((entry) => entry.platform || entry.value);
      } else if (parsedSocials && typeof parsedSocials === "object") {
        normalizedSocials = Object.entries(parsedSocials)
          .map(([platform, value]) => ({
            platform: asText(platform),
            value: asText(value),
          }))
          .map((entry) => ({
            platform: entry.platform,
            value: entry.value,
            profileLink: entry.value,
          }))
          .filter((entry) => entry.platform || entry.value);
      } else if (parsedSocials == null) {
        normalizedSocials = [];
      } else {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "socials", message: "socials must be an array or object map" }],
        });
      }
      patch.socials = db.raw("?::jsonb", [JSON.stringify(normalizedSocials)]);
      hasAnyUpdate = true;
    }

    const emailProvided = hasPayloadKey("email");
    const profilePhotoProvided =
      hasPayloadKey("profile_photo_url") ||
      hasPayloadKey("profilePhotoUrl") ||
      hasPayloadKey("profile_photo_media_asset_id") ||
      hasPayloadKey("profilePhotoMediaAssetId");
    const hasArtistUserMap = await db.schema.hasTable("artist_user_map");
    const hasUsersTable = await db.schema.hasTable("users");
    const canUpdateEmailInArtist = hasArtistColumn("email");
    const canUpdateEmailInUsers = hasArtistUserMap && hasUsersTable;
    if (emailProvided && !canUpdateEmailInArtist && !canUpdateEmailInUsers) {
      ignoredFields.push("email");
    }
    const hasEntityMediaLinks = await db.schema.hasTable("entity_media_links");
    const hasMediaAssets = await db.schema.hasTable("media_assets");

    await db.transaction(async (trx) => {
      if (Object.keys(patch).length > 0) {
        await trx("artists").where({ id: artistId }).update(patch);
      }

      if (emailProvided && (canUpdateEmailInArtist || canUpdateEmailInUsers)) {
        const nextEmailRaw = asText(payload.email).toLowerCase();
        if (nextEmailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmailRaw)) {
          throw Object.assign(new Error("validation"), {
            statusCode: 400,
            payload: {
              error: "validation",
              details: [{ field: "email", message: "email must be a valid email address" }],
            },
          });
        }

        if (canUpdateEmailInArtist) {
          await trx("artists").where({ id: artistId }).update({ email: nextEmailRaw || null });
          hasAnyUpdate = true;
        }

        if (nextEmailRaw && canUpdateEmailInUsers) {
          const linked = await trx("artist_user_map")
            .where({ artist_id: artistId })
            .select("user_id")
            .first();
          if (linked?.user_id) {
            await trx("users").where({ id: linked.user_id }).update({ email: nextEmailRaw });
            hasAnyUpdate = true;
          } else if (!canUpdateEmailInArtist) {
            ignoredFields.push("email");
          }
        }
      }

      if (profilePhotoProvided) {
        const requestedUrlRaw = asText(payload.profile_photo_url ?? payload.profilePhotoUrl);
        const requestedUrl = requestedUrlRaw ? toAbsolutePublicUrl(requestedUrlRaw) : "";
        const requestedMediaAssetId = asText(
          payload.profile_photo_media_asset_id ?? payload.profilePhotoMediaAssetId
        );

        if (hasArtistColumn("profile_photo_url")) {
          await trx("artists")
            .where({ id: artistId })
            .update({ profile_photo_url: requestedUrl || null });
          hasAnyUpdate = true;
        }

        if (hasEntityMediaLinks) {
          await trx("entity_media_links")
            .where({
              entity_type: "artist",
              entity_id: artistId,
              role: "profile_photo",
            })
            .delete();
          hasAnyUpdate = true;

          let mediaAssetId = requestedMediaAssetId || "";
          if (!mediaAssetId && requestedUrl && hasMediaAssets) {
            const mediaRow = await trx("media_assets")
              .select("id")
              .whereIn("public_url", [requestedUrlRaw, requestedUrl])
              .first();
            mediaAssetId = String(mediaRow?.id || "").trim();
          }

          if (mediaAssetId) {
            await trx("entity_media_links").insert({
              id: randomUUID(),
              media_asset_id: mediaAssetId,
              entity_type: "artist",
              entity_id: artistId,
              role: "profile_photo",
              sort_order: 0,
              created_at: trx.fn.now(),
            });
          }
        }
      }
    });

    if (!hasAnyUpdate) {
      if (ignoredFields.length > 0) {
        const detail = await fetchAdminArtistDetailPayload(db, artistId);
        return res.status(detail.statusCode).json({
          ...detail.body,
          ignoredFields: Array.from(new Set(ignoredFields)),
        });
      }
      return res.status(400).json({ error: "no_fields" });
    }

    const detail = await fetchAdminArtistDetailPayload(db, artistId);
    return res.status(detail.statusCode).json({
      ...detail.body,
      ...(ignoredFields.length > 0 ? { ignoredFields: Array.from(new Set(ignoredFields)) } : {}),
    });
  } catch (err) {
    if (err?.statusCode && err?.payload) {
      return res.status(err.statusCode).json(err.payload);
    }
    if (err?.code === "23505") {
      return res.status(409).json({ error: "conflict", message: "duplicate value" });
    }
    console.error("[admin artist update] error", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

module.exports = router;
