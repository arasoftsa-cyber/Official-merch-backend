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

  const hasInventorySkuField =
    hasOwn(variant, "inventorySkuId") || hasOwn(variant, "inventory_sku_id");
  const inventorySkuIdRaw = variant.inventorySkuId ?? variant.inventory_sku_id;
  const inventorySkuId = hasInventorySkuField ? asUuidOrNull(inventorySkuIdRaw) : undefined;
  if (hasInventorySkuField && !inventorySkuId) return { error: "invalid_inventory_sku_id" };

  const size = String(variant.size || "").trim() || "default";
  const color = String(variant.color || "").trim() || "default";
  const sku = String(variant.sku || "").trim() || null;

  let sellingPriceCents = undefined;
  if (
    typeof variant.priceCents !== "undefined" ||
    typeof variant.price_cents !== "undefined" ||
    typeof variant.sellingPriceCents !== "undefined" ||
    typeof variant.selling_price_cents !== "undefined"
  ) {
    sellingPriceCents = parseNonNegativeInt(
      variant.sellingPriceCents ??
        variant.selling_price_cents ??
        variant.priceCents ??
        variant.price_cents
    );
    if (sellingPriceCents === null) return { error: "invalid_price" };
  }

  const isListed = parseBooleanMaybe(variant.isListed ?? variant.is_listed);
  if (isListed === null) return { error: "invalid_is_listed" };

  const stock =
    typeof variant.stock !== "undefined" ? parseNonNegativeInt(variant.stock) : undefined;
  if (stock === null) return { error: "invalid_stock" };

  const vendorPayoutCents =
    typeof variant.vendorPayoutCents !== "undefined" ||
    typeof variant.vendor_payout_cents !== "undefined"
      ? parseNonNegativeInt(variant.vendorPayoutCents ?? variant.vendor_payout_cents)
      : undefined;
  if (vendorPayoutCents === null) return { error: "invalid_vendor_payout_cents" };

  const royaltyCents =
    typeof variant.royaltyCents !== "undefined" ||
    typeof variant.royalty_cents !== "undefined"
      ? parseNonNegativeInt(variant.royaltyCents ?? variant.royalty_cents)
      : undefined;
  if (royaltyCents === null) return { error: "invalid_royalty_cents" };

  const ourShareCents =
    typeof variant.ourShareCents !== "undefined" ||
    typeof variant.our_share_cents !== "undefined"
      ? parseNonNegativeInt(variant.ourShareCents ?? variant.our_share_cents)
      : undefined;
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
