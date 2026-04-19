const {
  detectNewMerchFlow,
  validateNewMerch,
  validateListingPhotoFiles,
  validateProductColors,
  parseMerchMoneyToCents,
} = require("../../../services/catalog.service");
const { getDb } = require("../../../core/db/db");
const {
  PRODUCT_STATUS_INACTIVE,
  PRODUCT_STATUS_REJECTED,
  normalizeProductStatusValue,
  statusFromIsActive,
  normalizeProductStatusFromRecord,
  canArtistToggleProductStatus,
  canAdminPatchProductStatus,
} = require("../status");
const { getRole, isAdmin } = require("../auth");
const { BAD_REQUEST, NOT_FOUND } = require("../helpers/http");
const {
  isHttpError,
  makeHttpError,
  validateCreateProductInput,
  validateUpdateProductInput,
  validateUpdateProductPhotosInput,
} = require("./product-mutations.validators");
const repo = require("./product-mutations.repository");

const createProductOperation = async ({ user, body, filesByField, fallbackBody, originalUrl }) => {
  if (!isAdmin(user)) {
    return makeHttpError(403, { error: "forbidden" });
  }

  const listingPhotoValidation = validateListingPhotoFiles(filesByField, { required: false });
  if (!listingPhotoValidation.ok) {
    return makeHttpError(400, { error: "validation", details: listingPhotoValidation.details });
  }

  const isNewMerchFlow = detectNewMerchFlow(body, filesByField);
  const db = getDb();

  if (isNewMerchFlow) {
    const validation = validateNewMerch(body, filesByField, { requireListingPhotos: false });
    if (!validation.ok) {
      return makeHttpError(400, { error: "validation", details: validation.details });
    }

    try {
      const created = await db.transaction(async (trx) =>
        repo.createNewMerchProductTx(trx, validation.value)
      );
      if (created?.validationError) {
        return makeHttpError(400, {
          error: "validation",
          details: [created.validationError],
        });
      }
      return {
        created,
        kind: "new_merch",
      };
    } catch (err) {
      console.error("[create_new_merch_product] failed", err);
      return makeHttpError(500, { error: "internal_server_error" });
    }
  }

  console.log(
    "[DBG products POST]",
    "file=catalog.controller.js",
    "role=",
    user?.role || user?.userRole,
    "userId=",
    user?.id,
    "url=",
    originalUrl
  );

  const createInput = validateCreateProductInput({ body, fallbackBody });
  if (isHttpError(createInput)) {
    return createInput;
  }

  let productRow = null;
  let variantRow = null;

  try {
    const created = await db.transaction(async (trx) =>
      repo.createStandardProductTx(trx, createInput)
    );
    productRow = created.productRow;
    variantRow = created.variantRow;
  } catch (err) {
    if (err?.code === "INVENTORY_SKU_NOT_FOUND") {
      return makeHttpError(400, { error: "inventory_sku_not_found" });
    }
    if (err?.code === "INVALID_VARIANT_ECONOMICS") {
      return makeHttpError(400, { error: err?.message || "invalid_variant_economics" });
    }
    if (err?.code === "VARIANT_SKU_CONFLICT") {
      return makeHttpError(500, { error: "internal_server_error", message: "variant_sku_conflict" });
    }
    console.error("[create_product] failed", err);
    return makeHttpError(500, { error: "internal_server_error" });
  }

  let listingPhotoUrls = [];
  if (Array.isArray(listingPhotoValidation.listingFiles) && listingPhotoValidation.listingFiles.length > 0) {
    try {
      listingPhotoUrls = await db.transaction(async (trx) =>
        repo.attachListingPhotosToProductTx(trx, {
          productId: productRow.id,
          files: listingPhotoValidation.listingFiles,
        })
      );
    } catch (err) {
      console.error("[create_product_listing_photos] failed", err);
      return makeHttpError(500, { error: "internal_server_error" });
    }
  }

  return {
    kind: "standard",
    productRow,
    variantRow,
    listingPhotoUrls,
  };
};

const updateProductOperation = async ({ user, id, payload }) => {
  const validatedInput = validateUpdateProductInput({ id, payload });
  if (isHttpError(validatedInput)) {
    return validatedInput;
  }

  const db = getDb();
  const patch = {};
  const role = getRole(user);
  const userId = user?.id;
  const artistPayloadKeys = new Set(["isActive", "status", "active"]);

  if (role === "artist") {
    const payloadKeys = Object.keys(payload || {});
    if (
      payloadKeys.length === 0 ||
      payloadKeys.some((key) => !artistPayloadKeys.has(key))
    ) {
      return makeHttpError(403, { error: "forbidden" });
    }

    const mapping = await repo.findArtistMappingByUser(db, userId);
    if (!mapping?.artist_id) {
      return makeHttpError(403, { error: "forbidden" });
    }

    const ownedProduct = await repo.findOwnedProduct(db, { id, artistId: mapping.artist_id });
    if (!ownedProduct) {
      return makeHttpError(403, { error: "forbidden" });
    }
  }

  const productColumns = await repo.loadProductColumns(db);
  const hasColumn = (name) => Object.prototype.hasOwnProperty.call(productColumns, name);
  const variantColumns = await repo.loadVariantColumns(db);
  const hasVariantColumn = (name) => Object.prototype.hasOwnProperty.call(variantColumns, name);
  const hasAnyPayloadKey = (keys = []) =>
    keys.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  const existingProduct = await repo.findProductById(db, id);
  if (!existingProduct) {
    return makeHttpError(404, NOT_FOUND);
  }
  const existingStatus = normalizeProductStatusFromRecord(existingProduct);
  if (role === "artist" && !canArtistToggleProductStatus(existingStatus, null)) {
    return makeHttpError(403, { error: "forbidden" });
  }

  if (typeof payload.title === "string") {
    patch.title = payload.title;
  }
  if (typeof payload.merch_name === "string" || typeof payload.merchName === "string") {
    const merchName = String(payload.merch_name ?? payload.merchName).trim();
    if (merchName.length < 2) {
      return makeHttpError(400, {
        error: "validation",
        details: [{ field: "merch_name", message: "merch_name must be at least 2 characters" }],
      });
    }
    patch.title = merchName;
  }
  if (typeof payload.description === "string") {
    patch.description = payload.description;
  }
  if (hasColumn("merch_story") && (typeof payload.merch_story === "string" || typeof payload.merchStory === "string")) {
    const merchStory = String(payload.merch_story ?? payload.merchStory).trim();
    if (merchStory.length < 10) {
      return makeHttpError(400, {
        error: "validation",
        details: [{ field: "merch_story", message: "merch_story must be at least 10 characters" }],
      });
    }
    patch.merch_story = merchStory;
  }
  if (hasColumn("merch_type") && (typeof payload.merch_type === "string" || typeof payload.merchType === "string")) {
    const merchType = String(payload.merch_type ?? payload.merchType).trim();
    if (!merchType) {
      return makeHttpError(400, {
        error: "validation",
        details: [{ field: "merch_type", message: "merch_type is required" }],
      });
    }
    patch.merch_type = merchType;
  }
  if (hasColumn("colors") && Object.prototype.hasOwnProperty.call(payload, "colors")) {
    const colorValidation = validateProductColors(payload.colors, {
      required: true,
      defaultToBlack: true,
    });
    if (!colorValidation.ok) {
      return makeHttpError(400, {
        error: "validation",
        details: colorValidation.details,
      });
    }
    patch.colors = db.raw("?::jsonb", [JSON.stringify(colorValidation.colors)]);
  }

  if (hasColumn("mrp_cents") && hasAnyPayloadKey(["mrp_cents", "mrpCents", "merch_mrp", "merchMrp"])) {
    const mrpParsed = parseMerchMoneyToCents({
      body: payload,
      centsKeys: ["mrp_cents", "mrpCents"],
      amountKeys: ["merch_mrp", "merchMrp"],
      minCents: 1,
      required: true,
    });
    if (!mrpParsed.ok || mrpParsed.value === null) {
      return makeHttpError(400, {
        error: "validation",
        details: [{ field: "mrp_cents", message: "mrp_cents/merch_mrp must be a number greater than 0" }],
      });
    }
    patch.mrp_cents = mrpParsed.value;
  }

  if (
    hasColumn("vendor_payout_cents") &&
    hasAnyPayloadKey([
      "vendor_pay_cents",
      "vendorPayCents",
      "vendor_payout_cents",
      "vendorPayoutCents",
      "vendor_pay",
      "vendorPay",
    ])
  ) {
    const vendorPayParsed = parseMerchMoneyToCents({
      body: payload,
      centsKeys: [
        "vendor_pay_cents",
        "vendorPayCents",
        "vendor_payout_cents",
        "vendorPayoutCents",
      ],
      amountKeys: ["vendor_pay", "vendorPay"],
      minCents: 0,
      required: true,
    });
    if (!vendorPayParsed.ok || vendorPayParsed.value === null) {
      return makeHttpError(400, {
        error: "validation",
        details: [
          {
            field: "vendor_payout_cents",
            message: "vendor_payout_cents/vendor_pay must be a number >= 0",
          },
        ],
      });
    }
    patch.vendor_payout_cents = vendorPayParsed.value;
  }

  if (
    hasColumn("selling_price_cents") &&
    hasAnyPayloadKey(["selling_price_cents", "sellingPriceCents", "price_cents", "priceCents"])
  ) {
    const sellingParsed = parseMerchMoneyToCents({
      body: payload,
      centsKeys: ["selling_price_cents", "sellingPriceCents", "price_cents", "priceCents"],
      amountKeys: ["selling_price", "sellingPrice", "price"],
      minCents: 1,
      required: true,
    });
    if (!sellingParsed.ok || sellingParsed.value === null) {
      return makeHttpError(400, {
        error: "validation",
        details: [
          {
            field: "selling_price_cents",
            message: "selling_price_cents/price must be a number greater than 0",
          },
        ],
      });
    }
    patch.selling_price_cents = sellingParsed.value;
  }

  if (hasColumn("our_share_cents") && hasAnyPayloadKey(["our_share_cents", "ourShareCents", "our_share", "ourShare"])) {
    const ourShareParsed = parseMerchMoneyToCents({
      body: payload,
      centsKeys: ["our_share_cents", "ourShareCents"],
      amountKeys: ["our_share", "ourShare"],
      minCents: 0,
      required: true,
    });
    if (!ourShareParsed.ok || ourShareParsed.value === null) {
      return makeHttpError(400, {
        error: "validation",
        details: [{ field: "our_share_cents", message: "our_share_cents/our_share must be a number >= 0" }],
      });
    }
    patch.our_share_cents = ourShareParsed.value;
  }

  if (hasColumn("royalty_cents") && hasAnyPayloadKey(["royalty_cents", "royaltyCents", "royalty"])) {
    const royaltyParsed = parseMerchMoneyToCents({
      body: payload,
      centsKeys: ["royalty_cents", "royaltyCents"],
      amountKeys: ["royalty"],
      minCents: 0,
      required: true,
    });
    if (!royaltyParsed.ok || royaltyParsed.value === null) {
      return makeHttpError(400, {
        error: "validation",
        details: [{ field: "royalty_cents", message: "royalty_cents/royalty must be a number >= 0" }],
      });
    }
    patch.royalty_cents = royaltyParsed.value;
  }

  const hasExplicitProductOurShare = hasAnyPayloadKey([
    "our_share_cents",
    "ourShareCents",
    "our_share",
    "ourShare",
  ]);
  if (hasColumn("our_share_cents") && !hasExplicitProductOurShare) {
    const nextSellingPrice = repo.parseNonNegativeInt(
      patch.selling_price_cents ??
        existingProduct.selling_price_cents ??
        patch.mrp_cents ??
        existingProduct.mrp_cents
    );
    const nextVendorPayout = repo.parseNonNegativeInt(
      patch.vendor_payout_cents ?? existingProduct.vendor_payout_cents
    );
    const nextRoyalty = repo.parseNonNegativeInt(
      patch.royalty_cents ?? existingProduct.royalty_cents
    );

    const shareResolution = repo.resolveOurShareCents({
      sellingPriceCents: nextSellingPrice,
      vendorPayoutCents:
        nextVendorPayout === null ? undefined : nextVendorPayout,
      royaltyCents: nextRoyalty === null ? undefined : nextRoyalty,
      ourShareCents: undefined,
    });
    if (shareResolution.error) {
      return makeHttpError(400, { error: shareResolution.error });
    }
    if (
      nextVendorPayout !== null &&
      nextRoyalty !== null &&
      typeof shareResolution.ourShareCents !== "number"
    ) {
      return makeHttpError(400, { error: "invalid_our_share_cents" });
    }
    if (typeof shareResolution.ourShareCents === "number") {
      patch.our_share_cents = shareResolution.ourShareCents;
    }
  }

  let nextStatus = null;
  if (typeof payload.active === "boolean") {
    nextStatus = statusFromIsActive(payload.active);
  } else if (typeof payload.isActive === "boolean") {
    nextStatus = statusFromIsActive(payload.isActive);
  } else if (typeof payload.status === "string") {
    nextStatus = normalizeProductStatusValue(payload.status);
    if (!nextStatus) {
      return makeHttpError(400, {
        error: "validation",
        details: [{ field: "status", message: "status must be pending, inactive, active, or rejected" }],
      });
    }
  }

  if (role === "artist" && !canArtistToggleProductStatus(existingStatus, nextStatus)) {
    return makeHttpError(403, { error: "forbidden" });
  }
  if (role === "admin" && nextStatus && !canAdminPatchProductStatus(existingStatus, nextStatus)) {
    return makeHttpError(400, {
      error: "invalid_status_transition",
      message:
        "Invalid status transition. Pending requests must be approved or rejected from the onboarding queue.",
    });
  }
  if (nextStatus) {
    patch.is_active = nextStatus === PRODUCT_STATUS_INACTIVE ? false : nextStatus === "active";
    if (hasColumn("status")) {
      patch.status = nextStatus;
    }
    if (hasColumn("rejection_reason") && nextStatus !== PRODUCT_STATUS_REJECTED) {
      patch.rejection_reason = null;
    }
  }

  if (hasColumn("rejection_reason") && role === "admin") {
    if (Object.prototype.hasOwnProperty.call(payload, "rejection_reason")) {
      patch.rejection_reason =
        payload.rejection_reason === null
          ? null
          : String(payload.rejection_reason || "").trim() || null;
    } else if (Object.prototype.hasOwnProperty.call(payload, "rejectionReason")) {
      patch.rejection_reason =
        payload.rejectionReason === null
          ? null
          : String(payload.rejectionReason || "").trim() || null;
    }
  }

  const variantPayloadInput = Array.isArray(payload.variants)
    ? payload.variants
    : payload.variant
    ? [payload.variant]
    : [];
  const variantPayloads = variantPayloadInput.filter(Boolean);

  if (role === "artist" && variantPayloads.length > 0) {
    return makeHttpError(403, { error: "forbidden" });
  }

  const hasProductFields = Object.keys(patch).length > 0;
  const hasVariantUpdates = variantPayloads.length > 0;
  if (!hasProductFields && !hasVariantUpdates) {
    return makeHttpError(400, { error: "no_fields" });
  }

  const productReturningFields = ["id", "title", "description", "is_active as isActive"];
  if (hasColumn("status")) productReturningFields.push("status");
  if (hasColumn("rejection_reason")) {
    productReturningFields.push("rejection_reason as rejectionReason");
  }
  if (hasColumn("sku_types")) {
    productReturningFields.push("sku_types as skuTypes");
  }

  if (Object.keys(patch).length > 0) {
    const updatedRows = await repo.updateProductReturning(db, { id, patch, returningFields: productReturningFields });
    if (!updatedRows || updatedRows.length === 0) {
      return makeHttpError(404, NOT_FOUND);
    }
  }

  const productRow = await repo.getProductReturning(db, { id, returningFields: productReturningFields });
  if (!productRow) {
    return makeHttpError(404, NOT_FOUND);
  }

  if (hasVariantUpdates) {
    for (const variantUpdate of variantPayloads) {
      const variantId =
        variantUpdate?.id || variantUpdate?.variantId || variantUpdate?.variant_id;
      if (!variantId) {
        return makeHttpError(400, { error: "missing_variant_id" });
      }

      const variantSelection = ["id"];
      if (hasVariantColumn("price_cents")) variantSelection.push("price_cents");
      if (hasVariantColumn("selling_price_cents")) variantSelection.push("selling_price_cents");
      if (hasVariantColumn("vendor_payout_cents")) variantSelection.push("vendor_payout_cents");
      if (hasVariantColumn("royalty_cents")) variantSelection.push("royalty_cents");
      if (hasVariantColumn("our_share_cents")) variantSelection.push("our_share_cents");
      const variantRow = await repo.getVariantForProduct(db, {
        productId: id,
        variantId,
        variantSelection,
      });
      if (!variantRow) {
        return makeHttpError(404, { error: "variant_not_found" });
      }

      const variantPatch = {};

      if (
        typeof variantUpdate.price !== "undefined" ||
        typeof variantUpdate.priceCents !== "undefined" ||
        typeof variantUpdate.price_cents !== "undefined" ||
        typeof variantUpdate.sellingPriceCents !== "undefined" ||
        typeof variantUpdate.selling_price_cents !== "undefined"
      ) {
        const priceResult = repo.normalizeProductPrice({
          price: variantUpdate.price,
          priceCents:
            variantUpdate.sellingPriceCents ??
            variantUpdate.selling_price_cents ??
            variantUpdate.priceCents ??
            variantUpdate.price_cents,
          requirePrice: false,
        });
        if (priceResult.error) {
          return makeHttpError(400, { error: priceResult.error });
        }
        if (typeof priceResult.priceCents === "number") {
          variantPatch.price_cents = priceResult.priceCents;
          if (hasVariantColumn("selling_price_cents")) {
            variantPatch.selling_price_cents = priceResult.priceCents;
          }
        }
      }

      if (
        typeof variantUpdate.isListed !== "undefined" ||
        typeof variantUpdate.is_listed !== "undefined"
      ) {
        const isListedRaw =
          typeof variantUpdate.isListed !== "undefined"
            ? variantUpdate.isListed
            : variantUpdate.is_listed;
        if (typeof isListedRaw !== "boolean") {
          return makeHttpError(400, { error: "invalid_is_listed" });
        }
        if (hasVariantColumn("is_listed")) {
          variantPatch.is_listed = isListedRaw;
        }
      }

      const nextInventorySkuId = repo.asUuidOrNull(
        variantUpdate.inventorySkuId ?? variantUpdate.inventory_sku_id
      );
      if (
        typeof variantUpdate.inventorySkuId !== "undefined" ||
        typeof variantUpdate.inventory_sku_id !== "undefined"
      ) {
        if (!hasVariantColumn("inventory_sku_id")) {
          return makeHttpError(500, { error: "inventory_sku_not_configured" });
        }
        if (!nextInventorySkuId) {
          return makeHttpError(400, { error: "invalid_inventory_sku_id" });
        }
        const existingSku = await repo.findInventorySkuById(db, nextInventorySkuId);
        if (!existingSku) {
          return makeHttpError(400, { error: "inventory_sku_not_found" });
        }
        const duplicateMapping = await repo.findDuplicateInventoryMapping(db, {
          productId: id,
          inventorySkuId: nextInventorySkuId,
          variantId,
        });
        if (duplicateMapping) {
          return makeHttpError(409, { error: "duplicate_inventory_sku_mapping" });
        }
        variantPatch.inventory_sku_id = nextInventorySkuId;
      }

      const payoutKeys = [
        ["vendor_payout_cents", "vendorPayoutCents"],
        ["royalty_cents", "royaltyCents"],
        ["our_share_cents", "ourShareCents"],
      ];
      for (const [snake, camel] of payoutKeys) {
        if (!hasVariantColumn(snake)) continue;
        if (
          typeof variantUpdate[snake] === "undefined" &&
          typeof variantUpdate[camel] === "undefined"
        ) {
          continue;
        }
        const parsed = repo.parseNonNegativeInt(variantUpdate[snake] ?? variantUpdate[camel]);
        if (parsed === null) {
          return makeHttpError(400, { error: `invalid_${snake}` });
        }
        variantPatch[snake] = parsed;
      }

      if (hasVariantColumn("our_share_cents")) {
        const hasExplicitOurShare =
          typeof variantUpdate.our_share_cents !== "undefined" ||
          typeof variantUpdate.ourShareCents !== "undefined";
        const nextSellingPrice = repo.parseNonNegativeInt(
          variantPatch.selling_price_cents ??
            variantRow.selling_price_cents ??
            variantPatch.price_cents ??
            variantRow.price_cents
        );
        const nextVendorPayout = repo.parseNonNegativeInt(
          variantPatch.vendor_payout_cents ?? variantRow.vendor_payout_cents
        );
        const nextRoyalty = repo.parseNonNegativeInt(
          variantPatch.royalty_cents ?? variantRow.royalty_cents
        );
        const nextOurShareInput = hasExplicitOurShare
          ? variantPatch.our_share_cents
          : repo.parseNonNegativeInt(variantRow.our_share_cents);

        const shareResolution = repo.resolveOurShareCents({
          sellingPriceCents: nextSellingPrice,
          vendorPayoutCents:
            nextVendorPayout === null ? undefined : nextVendorPayout,
          royaltyCents: nextRoyalty === null ? undefined : nextRoyalty,
          ourShareCents: nextOurShareInput === null ? undefined : nextOurShareInput,
        });
        if (shareResolution.error) {
          return makeHttpError(400, { error: shareResolution.error });
        }
        if (
          !hasExplicitOurShare &&
          nextVendorPayout !== null &&
          nextRoyalty !== null &&
          typeof shareResolution.ourShareCents !== "number"
        ) {
          return makeHttpError(400, { error: "invalid_our_share_cents" });
        }
        if (
          !hasExplicitOurShare &&
          typeof shareResolution.ourShareCents === "number"
        ) {
          variantPatch.our_share_cents = shareResolution.ourShareCents;
        }
      }

      if (Object.keys(variantPatch).length === 0) {
        continue;
      }

      if (hasVariantColumn("updated_at")) {
        variantPatch.updated_at = db.fn.now();
      }
      await repo.updateVariantById(db, { variantId, variantPatch });
    }
  }

  const primaryVariant = await repo.loadPrimaryVariant(db, id);

  return {
    productRow,
    primaryVariant,
  };
};

const updateProductPhotosOperation = async ({ user, id, filesByField }) => {
  if (!isAdmin(user)) {
    return makeHttpError(403, { error: "forbidden" });
  }

  const validatedInput = validateUpdateProductPhotosInput({ id });
  if (isHttpError(validatedInput)) {
    return validatedInput;
  }

  const listingValidation = validateListingPhotoFiles(filesByField, { required: true });
  if (!listingValidation.ok) {
    return makeHttpError(400, { error: "validation", details: listingValidation.details });
  }

  const db = getDb();
  const existing = await repo.findProductById(db, id);
  if (!existing) {
    return makeHttpError(404, NOT_FOUND);
  }

  try {
    const result = await db.transaction(async (trx) =>
      repo.replaceProductPhotosTx(trx, {
        id,
        files: listingValidation.listingFiles,
      })
    );

    return {
      productId: id,
      listingPhotoUrls: result.listingPhotoUrls,
    };
  } catch (err) {
    console.error("[update_product_photos] failed", err);
    return makeHttpError(500, { error: "internal_server_error" });
  }
};

module.exports = {
  createProductOperation,
  updateProductOperation,
  updateProductPhotosOperation,
};
