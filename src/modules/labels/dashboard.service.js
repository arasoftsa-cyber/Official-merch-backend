const { getDb } = require("../../config/db");

const ZERO_SUMMARY = {
  totalArtists: 0,
  activeArtists30d: 0,
  inactiveArtists: 0,
  totalGross: 0,
  artists: [],
};

const createZeroSummary = () => ({
  totalArtists: ZERO_SUMMARY.totalArtists,
  activeArtists30d: ZERO_SUMMARY.activeArtists30d,
  inactiveArtists: ZERO_SUMMARY.inactiveArtists,
  totalGross: ZERO_SUMMARY.totalGross,
  artists: [...ZERO_SUMMARY.artists],
});

const createEmptyDashboardPayload = () => ({
  ...createZeroSummary(),
  totalOrders: 0,
  totalUnits: 0,
  grossCents: 0,
});

const clampOrderLimit = (limitParam) =>
  Math.min(100, Math.max(10, Number(limitParam) || 50));

const getLabelArtistIds = async (labelId) => {
  if (!labelId) {
    return [];
  }
  const db = getDb();
  return db("label_artist_map").where({ label_id: labelId }).pluck("artist_id");
};

const resolveLabelIdForUser = async (db, userId) => {
  if (!userId) {
    return null;
  }
  const row = await db("label_users_map")
    .where({ user_id: userId })
    .first("label_id");
  return row?.label_id || null;
};

const getLabelDashboardSummary = async (labelId) => {
  const db = getDb();
  if (!labelId) {
    return createEmptyDashboardPayload();
  }

  const artistRows = await db("label_artist_map as lam")
    .join("artists as a", "a.id", "lam.artist_id")
    .where("lam.label_id", labelId)
    .select("a.id", "a.name", "a.handle");

  if (!artistRows.length) {
    return createEmptyDashboardPayload();
  }

  const artistIds = artistRows.map((row) => row.id);
  const artistMetaById = new Map(
    artistRows.map((row) => [
      row.id,
      {
        artistId: row.id,
        artistName: row.name || row.handle || row.id,
      },
    ])
  );

  const activeProductsRows = await db("products")
    .whereIn("artist_id", artistIds)
    .groupBy("artist_id")
    .select(
      "artist_id",
      db.raw("coalesce(sum(case when is_active then 1 else 0 end), 0) as activeProductsCount")
    );

  const activeProductsByArtistId = new Map(
    activeProductsRows.map((row) => [
      row.artist_id,
      Number(row.activeproductscount ?? row.activeProductsCount ?? 0),
    ])
  );

  const thirtyDayStats = await db("products as p")
    .leftJoin("order_items as oi", "oi.product_id", "p.id")
    .leftJoin("orders as o", function () {
      this.on("o.id", "=", "oi.order_id").andOn(
        "o.created_at",
        ">=",
        db.raw("now() - interval '30 days'")
      );
    })
    .whereIn("p.artist_id", artistIds)
    .groupBy("p.artist_id")
    .select(
      "p.artist_id as artistId",
      db.raw("count(distinct o.id) as orders30d"),
      db.raw("coalesce(sum(case when o.id is not null then oi.quantity else 0 end), 0) as units30d"),
      db.raw(
        "coalesce(sum(case when o.id is not null then oi.price_cents * oi.quantity else 0 end), 0) as gross30d"
      )
    );

  const statsByArtistId = new Map(
    thirtyDayStats.map((row) => [
      row.artistid ?? row.artistId,
      {
        orders30d: Number(row.orders30d ?? 0),
        units30d: Number(row.units30d ?? 0),
        gross30d: Number(row.gross30d ?? 0),
      },
    ])
  );

  const allTimeGrossRows = await db("products as p")
    .join("order_items as oi", "oi.product_id", "p.id")
    .whereIn("p.artist_id", artistIds)
    .sum({
      totalGross: db.raw("oi.price_cents * oi.quantity"),
    });
  const totalGross = Number(allTimeGrossRows?.[0]?.totalGross ?? 0);

  const artists = artistIds.map((artistId) => {
    const meta = artistMetaById.get(artistId);
    const stats = statsByArtistId.get(artistId) ?? {
      orders30d: 0,
      units30d: 0,
      gross30d: 0,
    };
    return {
      artistId,
      artistName: meta?.artistName ?? artistId,
      orders30d: stats.orders30d,
      gross30d: stats.gross30d,
      units30d: stats.units30d,
      activeProductsCount: activeProductsByArtistId.get(artistId) ?? 0,
    };
  });

  const activeArtists30d = artists.filter((artist) => artist.orders30d > 0).length;
  const totalArtists = artists.length;
  const inactiveArtists = Math.max(totalArtists - activeArtists30d, 0);

  return {
    totalArtists,
    activeArtists30d,
    inactiveArtists,
    totalGross,
    artists,
    // Backward-compatible fields
    totalOrders: artists.reduce((sum, artist) => sum + artist.orders30d, 0),
    totalUnits: artists.reduce((sum, artist) => sum + artist.units30d, 0),
    grossCents: totalGross,
  };
};

const debugLabelOrders = process.env.DEBUG_LABEL_ORDERS === "1";

const logLabelOrders = (labelId, artistCount, ordersCount) => {
  if (!debugLabelOrders) return;
  console.debug(
    `[label-orders] labelId=${labelId} artistIds=${artistCount} orders=${ordersCount}`
  );
};

const getLabelDashboardOrders = async (labelId, filters = {}) => {
  const { status, range, limit: limitParam } = filters;
  const limit = clampOrderLimit(limitParam);
  const db = getDb();
  const artistIds = await getLabelArtistIds(labelId);

  if (!labelId) {
    return { orders: [], meta: { status, range, limit } };
  }

  if (!artistIds.length) {
    return { orders: [], meta: { status, range, limit } };
  }

  if (debugLabelOrders) {
    const fetchColumns = async (table) =>
      (
        await db("information_schema.columns")
          .select("column_name")
          .where({ table_schema: "public", table_name: table })
          .orderBy("ordinal_position")
      ).map((row) => row.column_name);
    const [orderItemsCols, ordersCols, productsCols] = await Promise.all([
      fetchColumns("order_items"),
      fetchColumns("orders"),
      fetchColumns("products"),
    ]);
    console.debug(
      `[label-orders-schema] order_items cols=${orderItemsCols.join(
        ","
      )} | orders cols=${ordersCols.join(",")} | products cols=${productsCols.join(",")}`
    );
  }

  const labelOrderIdsQuery = db("orders as o")
    .distinct("o.id")
    .select("o.id", "o.created_at")
    .join("order_items as oi", "oi.order_id", "o.id")
    .join("products as p", "p.id", "oi.product_id")
    // Restrict orders to ones that contain an item for a linked artist.
    .whereIn("p.artist_id", artistIds)
    .orderBy("o.created_at", "desc")
    .orderBy("o.id", "desc")
    .limit(limit);

  if (status) {
    const normalized = `${status}`.toLowerCase();
    if (normalized !== "all" && normalized !== "") {
      labelOrderIdsQuery.andWhere("o.status", normalized);
    }
  }
  if (range === "30d") {
    labelOrderIdsQuery.andWhere("o.created_at", ">=", db.raw("now() - interval '30 days'"));
  }

  const orderIds = await labelOrderIdsQuery.pluck("o.id");
  if (!orderIds.length) {
    logLabelOrders(labelId, artistIds.length, 0);
    return { orders: [], meta: { status, range, limit } };
  }

  const rawRows = await db("order_items as oi")
    .select(
      "o.id as orderId",
      "o.status",
      "o.total_cents as totalCents",
      "o.created_at as createdAt",
      "o.buyer_user_id as buyerUserId",
      "oi.product_id as productId",
      "oi.product_variant_id as productVariantId",
      "oi.quantity",
      "oi.price_cents as priceCents",
      "p.artist_id as artistId"
    )
    .join("orders as o", "o.id", "oi.order_id")
    .join("products as p", "p.id", "oi.product_id")
    .whereIn("o.id", orderIds)
    .orderBy("o.created_at", "desc")
    .orderBy("oi.id", "asc");
  const orderMap = new Map();

  for (const row of rawRows) {
    const key = row.orderId;
    if (!orderMap.has(key)) {
      orderMap.set(key, {
        orderId: row.orderId,
        status: row.status,
        totalCents: Number(row.totalCents),
        createdAt: row.createdAt,
        buyerUserId: row.buyerUserId,
        items: [],
      });
    }
    orderMap.get(key).items.push({
      productId: row.productId,
      productVariantId: row.productVariantId,
      quantity: row.quantity,
      priceCents: Number(row.priceCents),
      artistId: row.artistId,
    });
  }

  const normalized = Array.from(orderMap.values()).map((order) => ({
    id: order.orderId ?? order.id,
    status: order.status,
    totalCents: order.totalCents,
    createdAt: order.createdAt ? order.createdAt.toISOString() : null,
    buyerUserId: order.buyerUserId,
    items: order.items,
  }));

  logLabelOrders(labelId, artistIds.length, normalized.length);

  return {
    orders: normalized,
    meta: { status, range, limit },
  };
};

const getLabelArtistSummary = async (labelId, artistId) => {
  if (!labelId || !artistId) {
    return null;
  }

  // Reuse the same aggregation contract as the label dashboard to keep behavior consistent.
  const summary = await getLabelDashboardSummary(labelId);
  const artists = Array.isArray(summary?.artists) ? summary.artists : [];
  const selected = artists.find((artist) => artist?.artistId === artistId);
  if (!selected) {
    return null;
  }

  return {
    artistId: selected.artistId,
    artistName: selected.artistName,
    orders30d: Number(selected.orders30d ?? 0),
    units30d: Number(selected.units30d ?? 0),
    gross30d: Number(selected.gross30d ?? 0),
    activeProductsCount: Number(selected.activeProductsCount ?? 0),
  };
};

module.exports = {
  getLabelDashboardSummary,
  getLabelDashboardOrders,
  getLabelArtistSummary,
  resolveLabelIdForUser,
  createZeroSummary,
  createEmptyDashboardPayload,
  clampOrderLimit,
};
