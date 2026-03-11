const {
  getActiveProducts,
  getAdminProducts,
  getProductById,
  loadProductListingPhotos,
  loadProductDesignImage,
  loadProductDesignImagesMap,
  attachListingPhotosToProducts,
} = require("../../../services/catalog.service");
const { buildSellableMinPriceSubquery } = require("../../../services/variantAvailability.service");
const { getDb } = require("../../../core/db/db");
const { getTableColumns } = require("../../../core/db/schemaCache");
const {
  PRODUCT_STATUS_ACTIVE,
  normalizeProductStatusValue,
  normalizeProductStatusFromRecord,
  withStatus,
} = require("../status");
const { getRole, isAdmin } = require("../auth");
const { NOT_FOUND } = require("../helpers/http");
const listProducts = async (req, res) => {
  const baseItems = isAdmin(req.user) ? await getAdminProducts() : await getActiveProducts();
  const items = (await attachListingPhotosToProducts(baseItems)).map(withStatus);
  res.json({ items });
};

const listArtistProducts = async (req, res) => {
  if (getRole(req.user) !== "artist") {
    return res.status(403).json({ error: "forbidden" });
  }

  const db = getDb();
  const mapping = await db("artist_user_map")
    .select("artist_id")
    .where({ user_id: req.user.id })
    .first();

  if (!mapping?.artist_id) {
    return res.json({ items: [] });
  }

  const productColumns = await getTableColumns(db, "products");
  const selections = [
    "id",
    "title",
    "description",
    "created_at as createdAt",
    "created_at as updatedAt",
    "artist_id as artistId",
    "is_active",
    "is_active as isActive",
    db.raw("is_active as active"),
    buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\""),
  ];
  if (Object.prototype.hasOwnProperty.call(productColumns, "status")) {
    selections.push("status");
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "rejection_reason")) {
    selections.push("rejection_reason as rejectionReason");
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "sku_types")) {
    selections.push("sku_types as skuTypes");
  }

  const artistProductsQuery = db("products")
    .select(selections)
    .where({ artist_id: mapping.artist_id })
    .orderBy("created_at", "desc");
  const rows = await artistProductsQuery;
  const designImageMap = await loadProductDesignImagesMap(rows.map((row) => row.id));
  const items = rows.map((row) => {
    const designImageUrl = designImageMap.get(row.id) || "";
    return withStatus({
      ...row,
      designImageUrl,
      design_image_url: designImageUrl,
      skuTypes: Array.isArray(row.skuTypes) ? row.skuTypes : [],
      sku_types: Array.isArray(row.skuTypes) ? row.skuTypes : [],
    });
  });

  return res.json({ items });
};

const getProduct = async (req, res) => {
  const { id } = req.params;
  const row = await getProductById(id);
  if (!row) {
    return res.status(404).json(NOT_FOUND);
  }
  const { product, variants } = row;
  const listingPhotoUrls = await loadProductListingPhotos(id);
  const designImageUrl = await loadProductDesignImage(id);
  const isAdminView = isAdmin(req.user);
  const productStatus = normalizeProductStatusFromRecord(product);
  if (!isAdminView) {
    const hasStatusColumn = Object.prototype.hasOwnProperty.call(product || {}, "status");
    if (hasStatusColumn) {
      const explicitStatus = normalizeProductStatusValue(product?.status);
      if (explicitStatus !== PRODUCT_STATUS_ACTIVE) {
        return res.status(404).json(NOT_FOUND);
      }
    } else if (productStatus !== PRODUCT_STATUS_ACTIVE) {
      return res.status(404).json(NOT_FOUND);
    }
  }
  const allVariants = Array.isArray(variants) ? variants : [];
  const sellableVariants = allVariants.filter((variant) => Boolean(variant?.effectiveSellable));
  const responseVariants = allVariants;
  const pricingSource = sellableVariants.length > 0 ? sellableVariants : responseVariants;
  const prices = pricingSource
    .map((variant) => Number(variant?.priceCents))
    .filter((value) => Number.isFinite(value));
  const minVariantPriceCents = prices.length ? Math.min(...prices) : null;
  const productPriceCents =
    typeof product?.priceCents === "number"
      ? product.priceCents
      : minVariantPriceCents;
  const photos = Array.isArray(listingPhotoUrls) ? listingPhotoUrls : [];
  const primaryPhotoUrl = photos[0] || "";
  const normalizedProduct = {
    ...product,
    status: productStatus,
    rejection_reason: product?.rejection_reason ?? null,
    rejectionReason: product?.rejection_reason ?? null,
    sku_types: Array.isArray(product?.sku_types) ? product.sku_types : [],
    skuTypes: Array.isArray(product?.sku_types) ? product.sku_types : [],
    design_image_url: designImageUrl,
    designImageUrl,
    listing_photos: photos,
    listingPhotoUrls: photos,
    photoUrls: photos,
    photos,
    listingPhotoUrl: primaryPhotoUrl,
    primaryPhotoUrl,
    priceCents: productPriceCents,
    minVariantPriceCents: productPriceCents,
  };

  return res.json({
    product: normalizedProduct,
    listing_photos: photos,
    design_image_url: designImageUrl,
    designImageUrl,
    listingPhotoUrl: primaryPhotoUrl,
    photoUrls: photos,
    photos,
    primaryPhotoUrl,
    variants: responseVariants,
  });
};

module.exports = {
  listProducts,
  listArtistProducts,
  getProduct,
};
