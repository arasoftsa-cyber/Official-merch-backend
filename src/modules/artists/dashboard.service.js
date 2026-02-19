const { getDb } = require("../../config/db");

const ZERO_SUMMARY = {
  totalOrders: 0,
  totalUnits: 0,
  grossCents: 0,
  byStatus: {
    placed: 0,
    cancelled: 0,
    fulfilled: 0,
  },
};

const getArtistDashboardSummary = async (userId) => {
  const db = getDb();
  const artistIds = await db("artist_user_map")
    .where({ user_id: userId })
    .pluck("artist_id");

  if (!artistIds.length) {
    return { ...ZERO_SUMMARY, byStatus: { ...ZERO_SUMMARY.byStatus } };
  }

  const baseQuery = db("order_items")
    .join("products", "products.id", "order_items.product_id")
    .join("orders", "orders.id", "order_items.order_id")
    .whereIn("products.artist_id", artistIds);

  const [{ totalOrders = 0 } = {}] = await baseQuery
    .clone()
    .countDistinct("orders.id as totalOrders");

  const [{ totalUnits = 0 } = {}] = await baseQuery
    .clone()
    .sum("order_items.quantity as totalUnits");

  const [{ grossCents = 0 } = {}] = await baseQuery.clone().sum({
    grossCents: db.raw("order_items.price_cents * order_items.quantity"),
  });

  const statusRows = await baseQuery
    .clone()
    .select("orders.status")
    .countDistinct("orders.id as count")
    .groupBy("orders.status");

  const byStatus = { placed: 0, cancelled: 0, fulfilled: 0 };
  for (const row of statusRows) {
    const status = row.status;
    if (["placed", "cancelled", "fulfilled"].includes(status)) {
      byStatus[status] = Number(row.count);
    }
  }

  return {
    totalOrders: Number(totalOrders),
    totalUnits: Number(totalUnits),
    grossCents: Number(grossCents),
    byStatus,
  };
};

const getArtistDashboardOrders = async (userId) => {
  const db = getDb();
  const artistIds = await db("artist_user_map")
    .where({ user_id: userId })
    .pluck("artist_id");

  if (!artistIds.length) {
    return [];
  }

  const rawRows = await db("order_items")
    .select(
      "orders.id as orderId",
      "orders.status",
      "orders.total_cents as totalCents",
      "orders.created_at as createdAt",
      "orders.buyer_user_id as buyerUserId",
      "order_items.product_id as productId",
      "order_items.product_variant_id as productVariantId",
      "order_items.quantity",
      "order_items.price_cents as priceCents"
    )
    .join("products", "products.id", "order_items.product_id")
    .join("orders", "orders.id", "order_items.order_id")
    .whereIn("products.artist_id", artistIds)
    .orderBy("orders.created_at", "desc")
    .limit(50);

  const orderMap = new Map();
  for (const row of rawRows) {
    const key = row.orderId;
    if (!orderMap.has(key)) {
      orderMap.set(key, {
        orderId: row.orderId,
        status: row.status,
        totalCents: Number(row.totalCents),
        createdAt: row.createdAt ? row.createdAt.toISOString() : null,
        buyerUserId: row.buyerUserId,
        items: [],
      });
    }
    orderMap.get(key).items.push({
      productId: row.productId,
      productVariantId: row.productVariantId,
      quantity: row.quantity,
      priceCents: Number(row.priceCents),
    });
  }

  return Array.from(orderMap.values());
};

const getArtistDashboardOrderDetail = async (userId, orderId) => {
  const db = getDb();
  const artistIds = await db("artist_user_map")
    .where({ user_id: userId })
    .pluck("artist_id");

  if (!artistIds.length || !orderId) {
    return null;
  }

  const scopedRows = await db("order_items")
    .select(
      "orders.id as orderId",
      "orders.status",
      "orders.total_cents as totalCents",
      "orders.created_at as createdAt",
      "orders.buyer_user_id as buyerUserId",
      "products.id as productId",
      "products.title as productTitle",
      "order_items.product_variant_id as productVariantId",
      "product_variants.sku as variantSku",
      "product_variants.size as variantSize",
      "product_variants.color as variantColor",
      "order_items.quantity",
      "order_items.price_cents as priceCents"
    )
    .join("products", "products.id", "order_items.product_id")
    .join("orders", "orders.id", "order_items.order_id")
    .leftJoin("product_variants", "product_variants.id", "order_items.product_variant_id")
    .where("orders.id", orderId)
    .whereIn("products.artist_id", artistIds)
    .orderBy("order_items.id", "asc");

  if (!scopedRows.length) {
    return null;
  }

  const firstRow = scopedRows[0];
  return {
    id: firstRow.orderId,
    status: firstRow.status,
    totalCents: Number(firstRow.totalCents ?? 0),
    createdAt: firstRow.createdAt ? firstRow.createdAt.toISOString() : null,
    buyerUserId: firstRow.buyerUserId,
    items: scopedRows.map((row) => ({
      productId: row.productId,
      productTitle: row.productTitle ?? row.productId,
      productVariantId: row.productVariantId,
      variantSku: row.variantSku ?? null,
      variantSize: row.variantSize ?? null,
      variantColor: row.variantColor ?? null,
      quantity: Number(row.quantity ?? 0),
      priceCents: Number(row.priceCents ?? 0),
      lineTotalCents: Number(row.priceCents ?? 0) * Number(row.quantity ?? 0),
    })),
  };
};

module.exports = {
  getArtistDashboardSummary,
  getArtistDashboardOrders,
  getArtistDashboardOrderDetail,
  ZERO_SUMMARY,
};
