const {
  saveProductListingPhotos,
  replaceProductListingPhotos,
} = require("../../../services/catalog.service");
const {
  buildVariantInventoryQuery,
  formatVariantInventoryRow,
} = require("../../../services/variantAvailability.service");
const { resolveOurShareCents } = require("../../../utils/economics");
const {
  sanitizeSkuSegment,
  buildDefaultSku,
  buildDefaultVariantSku,
  normalizeProductPrice,
  parseNonNegativeInt,
  asUuidOrNull,
} = require("../normalizers");
const {
  PRODUCT_STATUS_INACTIVE,
  PRODUCT_STATUS_ACTIVE,
  PRODUCT_STATUS_REJECTED,
  normalizeProductStatusFromRecord,
} = require("../status");
const { assertCatalogProductMutationSchema } = require("../../../core/db/schemaContract");

const DEFAULT_VARIANT_SKU = "DEFAULT";

const createNewMerchProductTx = async (trx, input) => {
  const {
    artistId,
    merchName,
    merchStory,
    mrpCents,
    sellingPriceCents,
    vendorPayoutCents,
    ourShareCents,
    royaltyCents,
    merchType,
    colors,
    listingFiles,
    description,
  } = input;

  const artistExists = await trx("artists").select("id").where({ id: artistId }).first();
  if (!artistExists) {
    return { validationError: { field: "artist_id", message: "artist_id does not exist" } };
  }

  const { productColumns, variantColumns } = await assertCatalogProductMutationSchema(trx);
  const hasVariantColumn = (name) =>
    Object.prototype.hasOwnProperty.call(variantColumns, name);
  const insertPayload = {
    artist_id: artistId,
    title: merchName,
    description: description || "",
    is_active: false,
    created_at: trx.fn.now(),
  };
  if (Object.prototype.hasOwnProperty.call(productColumns, "updated_at")) {
    insertPayload.updated_at = trx.fn.now();
  }

  if (Object.prototype.hasOwnProperty.call(productColumns, "merch_story")) {
    insertPayload.merch_story = merchStory;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "status")) {
    insertPayload.status = PRODUCT_STATUS_INACTIVE;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "rejection_reason")) {
    insertPayload.rejection_reason = null;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "mrp_cents")) {
    insertPayload.mrp_cents = mrpCents;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "vendor_payout_cents")) {
    insertPayload.vendor_payout_cents = vendorPayoutCents;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "selling_price_cents")) {
    insertPayload.selling_price_cents = sellingPriceCents;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "our_share_cents")) {
    insertPayload.our_share_cents = ourShareCents;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "royalty_cents")) {
    insertPayload.royalty_cents = royaltyCents;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "merch_type")) {
    insertPayload.merch_type = merchType;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "colors")) {
    insertPayload.colors = trx.raw("?::jsonb", [JSON.stringify(colors)]);
  }

  const productReturning = ["id", "created_at"];
  if (Object.prototype.hasOwnProperty.call(productColumns, "status")) {
    productReturning.push("status");
  }
  const [productRow] = await trx("products")
    .insert(insertPayload)
    .returning(productReturning);

  const defaultVariantPrice =
    Number.isInteger(sellingPriceCents) && sellingPriceCents >= 0
      ? sellingPriceCents
      : Number.isInteger(mrpCents) && mrpCents >= 0
      ? mrpCents
      : 0;
  const defaultVariantIsListed = defaultVariantPrice > 0;
  const [skuRow] = await trx("inventory_skus")
    .insert({
      supplier_sku: `NEWMERCH-${String(productRow.id).slice(0, 8)}-DEFAULT`,
      merch_type: merchType || "default",
      quality_tier: null,
      size: "default",
      color: "default",
      stock: 0,
      is_active: true,
      metadata: trx.raw(
        "?::jsonb",
        [JSON.stringify({ source: "catalog.controller.createProduct.new_merch" })]
      ),
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning(["id"]);

  const variantInsert = {
    product_id: productRow.id,
    sku: buildDefaultVariantSku(productRow.id),
    size: "default",
    color: "default",
    price_cents: defaultVariantPrice,
    created_at: trx.fn.now(),
  };
  if (hasVariantColumn("inventory_sku_id")) variantInsert.inventory_sku_id = skuRow?.id || null;
  if (hasVariantColumn("selling_price_cents")) {
    variantInsert.selling_price_cents = defaultVariantPrice;
  }
  if (hasVariantColumn("vendor_payout_cents")) {
    variantInsert.vendor_payout_cents = vendorPayoutCents;
  }
  if (hasVariantColumn("royalty_cents")) {
    variantInsert.royalty_cents = royaltyCents;
  }
  if (hasVariantColumn("our_share_cents")) {
    variantInsert.our_share_cents = ourShareCents;
  }
  if (hasVariantColumn("is_listed")) variantInsert.is_listed = defaultVariantIsListed;
  if (hasVariantColumn("stock")) variantInsert.stock = 0;
  if (hasVariantColumn("updated_at")) variantInsert.updated_at = trx.fn.now();
  await trx("product_variants").insert(variantInsert);

  let listingPhotoUrls = [];
  if (Array.isArray(listingFiles) && listingFiles.length > 0) {
    listingPhotoUrls = await saveProductListingPhotos({
      trx,
      productId: productRow.id,
      files: listingFiles,
    });
  }

  if (
    Object.prototype.hasOwnProperty.call(productColumns, "listing_photos") &&
    listingPhotoUrls.length > 0
  ) {
    await trx("products")
      .where({ id: productRow.id })
      .update({
        listing_photos: trx.raw("?::jsonb", [JSON.stringify(listingPhotoUrls)]),
      });
  }

  return {
    productId: productRow.id,
    createdAt: productRow.created_at,
    status: productRow.status || PRODUCT_STATUS_INACTIVE,
    listingPhotoUrls,
  };
};

const createStandardProductTx = async (trx, input) => {
  const {
    artistId,
    title,
    description,
    isActiveFlag,
    resolvedStatus,
    body,
    variantInput,
    bodySku,
    bodySupplierSku,
    bodySupplierSkuSnake,
    normalizedSize,
    normalizedColor,
    variantStock,
    priceResult,
    inventorySkuIdFromPayload,
  } = input;

  const {
    productColumns,
    variantColumns,
    inventorySkuColumns: skuColumns,
  } = await assertCatalogProductMutationSchema(trx);
  const hasProductColumn = (name) =>
    Object.prototype.hasOwnProperty.call(productColumns, name);
  const hasVariantColumn = (name) =>
    Object.prototype.hasOwnProperty.call(variantColumns, name);
  const hasSkuColumn = (name) => Object.prototype.hasOwnProperty.call(skuColumns, name);

  const productInsert = {
    artist_id: artistId,
    title,
    description: description || null,
    is_active: isActiveFlag,
    created_at: trx.fn.now(),
  };
  if (hasProductColumn("updated_at")) {
    productInsert.updated_at = trx.fn.now();
  }
  if (hasProductColumn("status")) {
    productInsert.status = resolvedStatus;
  }
  if (hasProductColumn("rejection_reason")) {
    productInsert.rejection_reason =
      resolvedStatus === PRODUCT_STATUS_REJECTED
        ? body.rejection_reason || body.rejectionReason || null
        : null;
  }

  const productReturning = ["id", "title", "description", "is_active as isActive"];
  if (hasProductColumn("status")) {
    productReturning.push("status");
  }
  const [insertedProduct] = await trx("products")
    .insert(productInsert)
    .returning(productReturning);

  if (!insertedProduct) {
    throw Object.assign(new Error("product_create_failed"), { code: "PRODUCT_CREATE_FAILED" });
  }

  const skuCandidate = variantInput?.sku ?? bodySku;
  const sanitizedSku = sanitizeSkuSegment(skuCandidate);
  const baseSku =
    sanitizedSku ||
    buildDefaultSku(insertedProduct.id, normalizedSize, normalizedColor) ||
    DEFAULT_VARIANT_SKU;
  const randomSuffix = () => Math.random().toString(36).slice(2, 6).toUpperCase();

  let resolvedInventorySkuId = inventorySkuIdFromPayload;
  if (resolvedInventorySkuId) {
    const existingSku = await trx("inventory_skus")
      .select("id")
      .where({ id: resolvedInventorySkuId })
      .first();
    if (!existingSku) {
      throw Object.assign(new Error("inventory_sku_not_found"), { code: "INVENTORY_SKU_NOT_FOUND" });
    }
  } else {
    const merchType =
      String(
        variantInput?.merchType ??
          variantInput?.merch_type ??
          body.merchType ??
          body.merch_type ??
          "default"
      ).trim() || "default";
    const suppliedSupplierSku =
      String(
        variantInput?.supplierSku ??
          variantInput?.supplier_sku ??
          bodySupplierSku ??
          bodySupplierSkuSnake ??
          ""
      ).trim() || "";
    const supplierSkuBase =
      suppliedSupplierSku ||
      `CATALOG-${String(insertedProduct.id).slice(0, 8)}-${normalizedColor}-${normalizedSize}`;
    let supplierSkuAttempt = supplierSkuBase;
    let supplierSkuAttempts = 0;

    while (supplierSkuAttempts < 4 && !resolvedInventorySkuId) {
      try {
        const skuInsert = {
          supplier_sku: supplierSkuAttempt,
          merch_type: merchType,
          quality_tier:
            variantInput?.qualityTier ??
            variantInput?.quality_tier ??
            body.qualityTier ??
            body.quality_tier ??
            null,
          size: normalizedSize,
          color: normalizedColor,
          stock: variantStock,
          is_active: true,
          metadata: trx.raw(
            "?::jsonb",
            [JSON.stringify({ source: "catalog.controller.createProduct" })]
          ),
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        };
        if (hasSkuColumn("supplier_cost_cents")) {
          skuInsert.supplier_cost_cents = parseNonNegativeInt(
            variantInput?.supplierCostCents ??
              variantInput?.supplier_cost_cents ??
              body.supplierCostCents ??
              body.supplier_cost_cents
          );
        }
        if (hasSkuColumn("mrp_cents")) {
          skuInsert.mrp_cents = parseNonNegativeInt(
            variantInput?.mrpCents ??
              variantInput?.mrp_cents ??
              body.mrpCents ??
              body.mrp_cents
          );
        }

        const [insertedSku] = await trx("inventory_skus")
          .insert(skuInsert)
          .returning(["id"]);
        resolvedInventorySkuId = insertedSku?.id || null;
      } catch (err) {
        if (err?.code === "23505") {
          supplierSkuAttempts += 1;
          supplierSkuAttempt = `${supplierSkuBase}-${randomSuffix()}`;
          continue;
        }
        throw err;
      }
    }
  }

  if (!resolvedInventorySkuId) {
    throw Object.assign(new Error("inventory_sku_create_failed"), {
      code: "INVENTORY_SKU_CREATE_FAILED",
    });
  }

  let insertedVariantId = null;
  let variantInsertAttempts = 0;
  while (variantInsertAttempts < 4 && !insertedVariantId) {
    const candidateSku = `${baseSku}${variantInsertAttempts ? `-${randomSuffix()}` : ""}`;
    try {
      const vendorPayoutParsed = parseNonNegativeInt(
        variantInput?.vendorPayoutCents ??
          variantInput?.vendor_payout_cents ??
          body.vendorPayoutCents ??
          body.vendor_payout_cents ??
          body.vendorPayCents ??
          body.vendor_pay_cents
      );
      const royaltyParsed = parseNonNegativeInt(
        variantInput?.royaltyCents ??
          variantInput?.royalty_cents ??
          body.royaltyCents ??
          body.royalty_cents
      );
      const ourShareParsed = parseNonNegativeInt(
        variantInput?.ourShareCents ??
          variantInput?.our_share_cents ??
          body.ourShareCents ??
          body.our_share_cents
      );
      const shareResolution = resolveOurShareCents({
        sellingPriceCents: priceResult.priceCents,
        vendorPayoutCents:
          vendorPayoutParsed === null ? undefined : vendorPayoutParsed,
        royaltyCents: royaltyParsed === null ? undefined : royaltyParsed,
        ourShareCents: ourShareParsed === null ? undefined : ourShareParsed,
      });
      if (shareResolution.error) {
        throw Object.assign(new Error(shareResolution.error), {
          code: "INVALID_VARIANT_ECONOMICS",
          field: "our_share_cents",
        });
      }
      if (
        ourShareParsed === null &&
        vendorPayoutParsed !== null &&
        royaltyParsed !== null &&
        typeof shareResolution.ourShareCents !== "number"
      ) {
        throw Object.assign(new Error("invalid_our_share_cents"), {
          code: "INVALID_VARIANT_ECONOMICS",
          field: "our_share_cents",
        });
      }

      const variantInsert = {
        product_id: insertedProduct.id,
        sku: candidateSku,
        size: normalizedSize,
        color: normalizedColor,
        price_cents: priceResult.priceCents,
        created_at: trx.fn.now(),
      };
      if (hasVariantColumn("inventory_sku_id")) {
        variantInsert.inventory_sku_id = resolvedInventorySkuId;
      }
      if (hasVariantColumn("selling_price_cents")) {
        variantInsert.selling_price_cents = priceResult.priceCents;
      }
      if (hasVariantColumn("vendor_payout_cents") && vendorPayoutParsed !== null) {
        variantInsert.vendor_payout_cents = vendorPayoutParsed;
      }
      if (hasVariantColumn("royalty_cents") && royaltyParsed !== null) {
        variantInsert.royalty_cents = royaltyParsed;
      }
      if (
        hasVariantColumn("our_share_cents") &&
        typeof shareResolution.ourShareCents === "number"
      ) {
        variantInsert.our_share_cents = shareResolution.ourShareCents;
      }
      if (hasVariantColumn("is_listed")) {
        variantInsert.is_listed = true;
      }
      if (hasVariantColumn("stock")) {
        variantInsert.stock = variantStock;
      }
      if (hasVariantColumn("updated_at")) {
        variantInsert.updated_at = trx.fn.now();
      }

      const [insertedVariant] = await trx("product_variants")
        .insert(variantInsert)
        .returning(["id"]);
      insertedVariantId = insertedVariant?.id || null;
    } catch (err) {
      if (err?.code === "23505" || err?.message?.includes("duplicate key")) {
        variantInsertAttempts += 1;
        continue;
      }
      throw err;
    }
  }

  if (!insertedVariantId) {
    throw Object.assign(new Error("variant_sku_conflict"), { code: "VARIANT_SKU_CONFLICT" });
  }

  const insertedVariantRow = await buildVariantInventoryQuery(trx, {
    productId: insertedProduct.id,
  })
    .where("pv.id", insertedVariantId)
    .first();

  return {
    productRow: insertedProduct,
    variantRow: formatVariantInventoryRow(insertedVariantRow),
  };
};

const attachListingPhotosToProductTx = async (trx, { productId, files }) => {
  const { productColumns } = await assertCatalogProductMutationSchema(trx);
  const listingPhotoUrls = await saveProductListingPhotos({
    trx,
    productId,
    files,
  });
  if (
    Object.prototype.hasOwnProperty.call(productColumns, "listing_photos") &&
    listingPhotoUrls.length > 0
  ) {
    await trx("products")
      .where({ id: productId })
      .update({
        listing_photos: trx.raw("?::jsonb", [JSON.stringify(listingPhotoUrls)]),
      });
  }
  return listingPhotoUrls;
};

const findArtistMappingByUser = (db, userId) =>
  db("artist_user_map")
    .select("artist_id")
    .where({ user_id: userId })
    .first();

const findOwnedProduct = (db, { id, artistId }) =>
  db("products")
    .select("id")
    .where({ id, artist_id: artistId })
    .first();

const loadProductColumns = async (db) =>
  (await assertCatalogProductMutationSchema(db)).productColumns;
const loadVariantColumns = async (db) =>
  (await assertCatalogProductMutationSchema(db)).variantColumns;
const findProductById = (db, id) => db("products").where({ id }).first();

const updateProductReturning = (db, { id, patch, returningFields }) =>
  db("products")
    .where({ id })
    .update(patch)
    .returning(returningFields);

const getProductReturning = (db, { id, returningFields }) =>
  db("products")
    .select(returningFields)
    .where({ id })
    .first();

const getVariantForProduct = (db, { productId, variantId, variantSelection }) =>
  db("product_variants")
    .select(variantSelection)
    .where({ id: variantId, product_id: productId })
    .first();

const findInventorySkuById = (db, inventorySkuId) =>
  db("inventory_skus")
    .select("id")
    .where({ id: inventorySkuId })
    .first();

const findDuplicateInventoryMapping = (db, { productId, inventorySkuId, variantId }) =>
  db("product_variants")
    .select("id")
    .where({ product_id: productId, inventory_sku_id: inventorySkuId })
    .whereNot({ id: variantId })
    .first();

const updateVariantById = (db, { variantId, variantPatch }) =>
  db("product_variants")
    .where({ id: variantId })
    .update(variantPatch);

const loadPrimaryVariant = async (db, productId) => {
  const primaryVariantRaw = await buildVariantInventoryQuery(db, { productId })
    .orderBy("pv.created_at", "asc")
    .first();
  return formatVariantInventoryRow(primaryVariantRaw);
};

const replaceProductPhotosTx = async (trx, { id, files }) => {
  const { productColumns } = await assertCatalogProductMutationSchema(trx);
  const listingPhotoUrls = await replaceProductListingPhotos({
    trx,
    productId: id,
    files,
  });

  if (Object.prototype.hasOwnProperty.call(productColumns, "listing_photos")) {
    await trx("products")
      .where({ id })
      .update({
        listing_photos: trx.raw("?::jsonb", [JSON.stringify(listingPhotoUrls)]),
      });
  }

  return { listingPhotoUrls };
};

module.exports = {
  asUuidOrNull,
  normalizeProductPrice,
  parseNonNegativeInt,
  resolveOurShareCents,
  normalizeProductStatusFromRecord,
  PRODUCT_STATUS_ACTIVE,
  PRODUCT_STATUS_REJECTED,
  createNewMerchProductTx,
  createStandardProductTx,
  attachListingPhotosToProductTx,
  findArtistMappingByUser,
  findOwnedProduct,
  loadProductColumns,
  loadVariantColumns,
  findProductById,
  updateProductReturning,
  getProductReturning,
  getVariantForProduct,
  findInventorySkuById,
  findDuplicateInventoryMapping,
  updateVariantById,
  loadPrimaryVariant,
  replaceProductPhotosTx,
};
