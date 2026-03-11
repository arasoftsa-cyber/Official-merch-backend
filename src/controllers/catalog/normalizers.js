const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sanitizeSkuSegment = (value) => {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
};

const buildDefaultSku = (productId, sizeSegment, colorSegment) => {
  const cleanSize = sanitizeSkuSegment(sizeSegment) || "SIZE";
  const cleanColor = sanitizeSkuSegment(colorSegment) || "COLOR";
  const prefix = productId ? productId.slice(0, 8) : "XXXX";
  return `SKU-${prefix}-${cleanSize}-${cleanColor}`;
};

const buildDefaultVariantSku = (productId) => {
  const cleanProductId = String(productId || "").trim();
  return `SKU-${cleanProductId || "PRODUCT"}-DEFAULT`;
};

const normalizeProductPrice = ({ price, priceCents, requirePrice = true } = {}) => {
  if (priceCents !== undefined && priceCents !== null) {
    const candidate = Number(priceCents);
    if (!Number.isFinite(candidate) || !Number.isInteger(candidate) || candidate <= 0) {
      return { error: "invalid_price" };
    }
    return { priceCents: candidate };
  }

  if (price !== undefined && price !== null) {
    if (typeof price === "number") {
      if (!Number.isFinite(price) || price <= 0) {
        return { error: "invalid_price" };
      }
      return { priceCents: Math.round(price * 100) };
    }

    if (typeof price === "string") {
      const trimmed = price.trim();
      if (trimmed === "") {
        return { error: "invalid_price" };
      }
      const candidate = Number(trimmed);
      if (!Number.isFinite(candidate) || candidate <= 0) {
        return { error: "invalid_price" };
      }
      return { priceCents: Math.round(candidate * 100) };
    }

    return { error: "invalid_price" };
  }

  if (requirePrice) {
    return { error: "missing_price" };
  }
  return {};
};

const parseNonNegativeInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

const asUuidOrNull = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return UUID_RE.test(normalized) ? normalized : null;
};

module.exports = {
  sanitizeSkuSegment,
  buildDefaultSku,
  buildDefaultVariantSku,
  normalizeProductPrice,
  parseNonNegativeInt,
  asUuidOrNull,
};
