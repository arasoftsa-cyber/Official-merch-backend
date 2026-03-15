"use strict";

const { createContractError, resolveAliasedField } = require("./shared");

const asText = (value) =>
  value === undefined ? undefined : value === null ? null : String(value).trim();

const normalizeVariantDto = (input = {}) => {
  const inventorySkuIdField = resolveAliasedField({
    input,
    canonicalKey: "inventorySkuId",
    aliases: ["inventory_sku_id"],
    normalize: (value) => String(value || "").trim(),
  });
  const sellingPriceField = resolveAliasedField({
    input,
    canonicalKey: "sellingPriceCents",
    aliases: ["selling_price_cents", "priceCents", "price_cents"],
    normalize: (value) => value,
  });
  const isListedField = resolveAliasedField({
    input,
    canonicalKey: "isListed",
    aliases: ["is_listed"],
    normalize: (value) => value,
  });
  const vendorPayoutField = resolveAliasedField({
    input,
    canonicalKey: "vendorPayoutCents",
    aliases: ["vendor_payout_cents"],
    normalize: (value) => value,
  });
  const royaltyField = resolveAliasedField({
    input,
    canonicalKey: "royaltyCents",
    aliases: ["royalty_cents"],
    normalize: (value) => value,
  });
  const ourShareField = resolveAliasedField({
    input,
    canonicalKey: "ourShareCents",
    aliases: ["our_share_cents"],
    normalize: (value) => value,
  });

  return {
    dto: {
      id: asText(input.id),
      sku: asText(input.sku),
      size: asText(input.size),
      color: asText(input.color),
      stock: input.stock,
      inventorySkuId: inventorySkuIdField.value,
      sellingPriceCents: sellingPriceField.value,
      isListed: isListedField.value,
      vendorPayoutCents: vendorPayoutField.value,
      royaltyCents: royaltyField.value,
      ourShareCents: ourShareField.value,
    },
    legacyKeys: [
      ...inventorySkuIdField.legacyKeys,
      ...sellingPriceField.legacyKeys,
      ...isListedField.legacyKeys,
      ...vendorPayoutField.legacyKeys,
      ...royaltyField.legacyKeys,
      ...ourShareField.legacyKeys,
    ],
  };
};

const normalizePutProductVariantsPayload = (input = {}) => {
  const body = input && typeof input === "object" ? input : {};
  if (!Array.isArray(body.variants)) {
    return { dto: { variants: [] }, meta: { legacyKeys: [] } };
  }
  const normalized = body.variants.map((entry) => normalizeVariantDto(entry));
  return {
    dto: { variants: normalized.map((entry) => entry.dto) },
    meta: { legacyKeys: normalized.flatMap((entry) => entry.legacyKeys) },
  };
};

const validatePutProductVariantsPayload = (payload = {}) => {
  if (!Array.isArray(payload.variants)) {
    throw createContractError({ message: "missing_variants" });
  }
  return payload;
};

const normalizeInventorySkuCreatePayload = (input = {}) => {
  const supplierSkuField = resolveAliasedField({
    input,
    canonicalKey: "supplierSku",
    aliases: ["supplier_sku"],
    normalize: asText,
  });
  const merchTypeField = resolveAliasedField({
    input,
    canonicalKey: "merchType",
    aliases: ["merch_type"],
    normalize: asText,
  });
  const qualityTierField = resolveAliasedField({
    input,
    canonicalKey: "qualityTier",
    aliases: ["quality_tier"],
    normalize: asText,
  });
  const isActiveField = resolveAliasedField({
    input,
    canonicalKey: "isActive",
    aliases: ["is_active"],
    normalize: (value) => value,
  });
  const supplierCostField = resolveAliasedField({
    input,
    canonicalKey: "supplierCostCents",
    aliases: ["supplier_cost_cents"],
    normalize: (value) => value,
  });
  const mrpField = resolveAliasedField({
    input,
    canonicalKey: "mrpCents",
    aliases: ["mrp_cents"],
    normalize: (value) => value,
  });

  return {
    dto: {
      supplierSku: supplierSkuField.value,
      merchType: merchTypeField.value,
      qualityTier: qualityTierField.value,
      size: asText(input.size),
      color: asText(input.color),
      stock: input.stock,
      isActive: isActiveField.value,
      supplierCostCents: supplierCostField.value,
      mrpCents: mrpField.value,
      metadata:
        input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
          ? input.metadata
          : input.metadata,
    },
    meta: {
      legacyKeys: [
        ...supplierSkuField.legacyKeys,
        ...merchTypeField.legacyKeys,
        ...qualityTierField.legacyKeys,
        ...isActiveField.legacyKeys,
        ...supplierCostField.legacyKeys,
        ...mrpField.legacyKeys,
      ],
    },
  };
};

const validateInventorySkuCreatePayload = (payload = {}) => payload;

const normalizeBulkDeactivateInventorySkusPayload = (input = {}) => {
  const merchTypeField = resolveAliasedField({
    input,
    canonicalKey: "merchType",
    aliases: ["merch_type"],
    normalize: asText,
  });

  return {
    dto: {
      merchType: merchTypeField.value,
      color: asText(input.color),
      size: asText(input.size),
    },
    meta: {
      legacyKeys: [...merchTypeField.legacyKeys],
    },
  };
};

const validateBulkDeactivateInventorySkusPayload = (payload = {}) => payload;

const normalizePatchInventorySkuPayload = (input = {}) => {
  const base = normalizeInventorySkuCreatePayload(input);
  const stockField = resolveAliasedField({
    input,
    canonicalKey: "stock",
    aliases: ["stock_cents"],
    normalize: (value) => value,
  });
  const stockDeltaField = resolveAliasedField({
    input,
    canonicalKey: "stockDelta",
    aliases: ["stock_delta"],
    normalize: (value) => value,
  });

  return {
    dto: {
      ...base.dto,
      stock: stockField.value,
      stockDelta: stockDeltaField.value,
    },
    meta: {
      legacyKeys: [
        ...base.meta.legacyKeys,
        ...stockField.legacyKeys,
        ...stockDeltaField.legacyKeys,
      ],
    },
  };
};

const validatePatchInventorySkuPayload = (payload = {}) => {
  if (typeof payload.stock !== "undefined" && typeof payload.stockDelta !== "undefined") {
    throw createContractError({ message: "stock_and_stock_delta_conflict" });
  }
  return payload;
};

module.exports = {
  normalizePutProductVariantsPayload,
  validatePutProductVariantsPayload,
  normalizeInventorySkuCreatePayload,
  validateInventorySkuCreatePayload,
  normalizeBulkDeactivateInventorySkusPayload,
  validateBulkDeactivateInventorySkusPayload,
  normalizePatchInventorySkuPayload,
  validatePatchInventorySkuPayload,
};
