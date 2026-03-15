const { resolveOurShareCents } = require("../utils/economics");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_STATUS_ACTIVE = "active";
const PRODUCT_STATUS_INACTIVE = "inactive";
const PRODUCT_STATUS_PENDING = "pending";
const PRODUCT_STATUS_REJECTED = "rejected";
const PRODUCT_STATUS_VALUES = new Set([
  PRODUCT_STATUS_PENDING,
  PRODUCT_STATUS_INACTIVE,
  PRODUCT_STATUS_ACTIVE,
  PRODUCT_STATUS_REJECTED,
]);

const asUuidOrNull = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return UUID_RE.test(normalized) ? normalized : null;
};

const parseNonNegativeInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue) || numberValue < 0) {
    return null;
  }
  return numberValue;
};

const parseInteger = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue)) return null;
  return numberValue;
};

const parseBooleanMaybe = (value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return null;
};

const parseNullableText = (value, { maxLength = 120 } = {}) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
};

const throwWithCode = (code) => {
  const err = new Error(code.toLowerCase());
  err.code = code;
  throw err;
};

const normalizeProductStatusValue = (rawValue) => {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.trim().toLowerCase();
  if (!PRODUCT_STATUS_VALUES.has(normalized)) return null;
  return normalized;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const conflictFor = (canonicalKey, aliasKey) => {
  const err = new Error(
    `Conflicting payload fields: '${canonicalKey}' and legacy alias '${aliasKey}' both provided with different values.`
  );
  err.code = "validation_error";
  throw err;
};

const resolveLegacyPair = ({ input, canonicalKey, aliasKey, normalize = (value) => value }) => {
  const hasCanonical = hasOwn(input, canonicalKey);
  const hasAlias = hasOwn(input, aliasKey);
  if (!hasCanonical && !hasAlias) return undefined;

  const canonicalValue = hasCanonical ? normalize(input[canonicalKey]) : undefined;
  const aliasValue = hasAlias ? normalize(input[aliasKey]) : undefined;
  if (hasCanonical && hasAlias && canonicalValue !== aliasValue) {
    conflictFor(canonicalKey, aliasKey);
  }
  return hasCanonical ? canonicalValue : aliasValue;
};

const validateListedVariantPrice = ({ isListed, sellingPriceCents }) => {
  if (!isListed) return true;
  return Number.isInteger(sellingPriceCents) && sellingPriceCents > 0;
};

const normalizeVariant = (variant) => {
  if (!variant || typeof variant !== "object") {
    return { error: "variant_missing" };
  }

  const idValue = String(variant.id || "").trim();
  if (idValue && !asUuidOrNull(idValue)) {
    return { error: "invalid_variant_id" };
  }

  const inventorySkuIdRaw = resolveLegacyPair({
    input: variant,
    canonicalKey: "inventorySkuId",
    aliasKey: "inventory_sku_id",
    normalize: (value) => String(value || "").trim(),
  });
  const hasInventorySkuField = typeof inventorySkuIdRaw !== "undefined";
  const inventorySkuId = hasInventorySkuField ? asUuidOrNull(inventorySkuIdRaw) : undefined;
  if (hasInventorySkuField && !inventorySkuId) return { error: "invalid_inventory_sku_id" };

  const size = String(variant.size || "").trim() || "default";
  const color = String(variant.color || "").trim() || "default";
  const sku = String(variant.sku || "").trim() || null;

  let sellingPriceCents = undefined;
  const sellingPriceRaw = resolveLegacyPair({
    input: variant,
    canonicalKey: "sellingPriceCents",
    aliasKey: "selling_price_cents",
  });
  if (typeof sellingPriceRaw !== "undefined") {
    sellingPriceCents = parseNonNegativeInt(sellingPriceRaw);
    if (sellingPriceCents === null) return { error: "invalid_price" };
  }

  const isListed = parseBooleanMaybe(
    resolveLegacyPair({
      input: variant,
      canonicalKey: "isListed",
      aliasKey: "is_listed",
    })
  );
  if (isListed === null) return { error: "invalid_is_listed" };

  const stock =
    typeof variant.stock !== "undefined" ? parseNonNegativeInt(variant.stock) : undefined;
  if (stock === null) return { error: "invalid_stock" };

  const vendorPayoutRaw = resolveLegacyPair({
    input: variant,
    canonicalKey: "vendorPayoutCents",
    aliasKey: "vendor_payout_cents",
  });
  const vendorPayoutCents =
    typeof vendorPayoutRaw !== "undefined" ? parseNonNegativeInt(vendorPayoutRaw) : undefined;
  if (vendorPayoutCents === null) return { error: "invalid_vendor_payout_cents" };

  const royaltyRaw = resolveLegacyPair({
    input: variant,
    canonicalKey: "royaltyCents",
    aliasKey: "royalty_cents",
  });
  const royaltyCents =
    typeof royaltyRaw !== "undefined" ? parseNonNegativeInt(royaltyRaw) : undefined;
  if (royaltyCents === null) return { error: "invalid_royalty_cents" };

  const ourShareRaw = resolveLegacyPair({
    input: variant,
    canonicalKey: "ourShareCents",
    aliasKey: "our_share_cents",
  });
  const ourShareCents =
    typeof ourShareRaw !== "undefined" ? parseNonNegativeInt(ourShareRaw) : undefined;
  if (ourShareCents === null) return { error: "invalid_our_share_cents" };

  const shareResolution = resolveOurShareCents({
    sellingPriceCents,
    vendorPayoutCents,
    royaltyCents,
    ourShareCents,
  });
  if (shareResolution.error) return { error: shareResolution.error };
  if (
    typeof ourShareCents === "undefined" &&
    typeof sellingPriceCents === "number" &&
    typeof vendorPayoutCents === "number" &&
    typeof royaltyCents === "number" &&
    typeof shareResolution.ourShareCents !== "number"
  ) {
    return { error: "invalid_our_share_cents" };
  }

  return {
    value: {
      id: idValue || null,
      sku,
      size,
      color,
      inventory_sku_id: inventorySkuId,
      selling_price_cents: sellingPriceCents,
      is_listed: isListed,
      stock,
      vendor_payout_cents: vendorPayoutCents,
      royalty_cents: royaltyCents,
      our_share_cents: shareResolution.ourShareCents,
    },
  };
};

const validateUniqueInventorySkuMappings = (variants = []) => {
  const seen = new Set();
  for (const variant of variants) {
    const key = variant.inventory_sku_id;
    if (!key) continue;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
};

module.exports = {
  PRODUCT_STATUS_ACTIVE,
  asUuidOrNull,
  parseNonNegativeInt,
  parseInteger,
  parseBooleanMaybe,
  parseNullableText,
  throwWithCode,
  normalizeProductStatusValue,
  validateListedVariantPrice,
  normalizeVariant,
  validateUniqueInventorySkuMappings,
};
