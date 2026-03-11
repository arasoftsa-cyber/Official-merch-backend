const { getDb } = require("../../core/db/db");
const { getTableColumns } = require("../../core/db/schemaCache");
const {
  buildSellableMinPriceSubquery,
  applySellableVariantExists,
  buildVariantInventoryQuery,
  formatVariantInventoryRow,
} = require("../variantAvailability.service");

const getActiveProducts = async () => {
  const db = getDb();
  const productColumns = await getTableColumns(db, "products");
  const hasStatus = Object.prototype.hasOwnProperty.call(productColumns, "status");
  const hasIsActive = Object.prototype.hasOwnProperty.call(productColumns, "is_active");
  const query = db("products")
    .select(
      "id",
      "title",
      "description",
      "created_at",
      "artist_id as artistId",
      "is_active",
      "is_active as isActive",
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"priceCents\""),
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\"")
    );
  if (hasStatus) {
    query.where({ status: "active" });
  } else if (hasIsActive) {
    query.where({ is_active: true });
  } else {
    query.whereRaw("1 = 0");
  }
  applySellableVariantExists(query);
  return query;
};

const getAdminProducts = async () => {
  const db = getDb();
  const columns = await getTableColumns(db, "products");
  const selections = [
    "id",
    "title",
    "description",
    "created_at",
    "artist_id as artistId",
    "is_active",
    "is_active as isActive",
  ];
  const hasStatus = Object.prototype.hasOwnProperty.call(columns, "status");

  if (Object.prototype.hasOwnProperty.call(columns, "merch_story")) {
    selections.push("merch_story");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "mrp_cents")) {
    selections.push("mrp_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "vendor_payout_cents")) {
    selections.push("vendor_payout_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "selling_price_cents")) {
    selections.push("selling_price_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "our_share_cents")) {
    selections.push("our_share_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "royalty_cents")) {
    selections.push("royalty_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "merch_type")) {
    selections.push("merch_type");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "colors")) {
    selections.push("colors");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "listing_photos")) {
    selections.push("listing_photos");
  }
  if (hasStatus) {
    selections.push("status");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "rejection_reason")) {
    selections.push("rejection_reason");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "sku_types")) {
    selections.push("sku_types");
  }

  const query = db("products")
    .select(
      selections.concat([
        buildSellableMinPriceSubquery(db).wrap("(", ") as \"priceCents\""),
        buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\""),
      ])
    );

  if (hasStatus) {
    query.where((builder) => {
      builder
        .whereIn("status", ["active", "inactive"])
        .orWhere((fallback) => fallback.whereNull("status").andWhere("is_active", true));
    });
  }

  return query.orderBy("created_at", "desc");
};

const getProductsByArtistId = async (artistId) => {
  const db = getDb();
  const columns = await getTableColumns(db, "products");
  const selections = [
    "id",
    "title",
    "description",
    "created_at",
    "updated_at",
    "artist_id as artistId",
    "is_active",
    "is_active as isActive",
  ];
  if (Object.prototype.hasOwnProperty.call(columns, "status")) {
    selections.push("status");
  }
  return db("products")
    .select(
      ...selections,
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\"")
    )
    .where({ artist_id: artistId })
    .orderBy("created_at", "desc");
};

const getProductById = async (id) => {
  const db = getDb();
  const product = await db("products")
    .select(
      "products.*",
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"priceCents\""),
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\"")
    )
    .where({ id })
    .first();
  if (!product) {
    return null;
  }
  const variants = (
    await buildVariantInventoryQuery(db, { productId: id }).orderBy("pv.created_at", "asc")
  ).map(formatVariantInventoryRow);
  return {
    product,
    variants,
  };
};

module.exports = {
  getActiveProducts,
  getAdminProducts,
  getProductsByArtistId,
  getProductById,
};

