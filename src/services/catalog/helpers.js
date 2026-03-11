const readText = (value) => (typeof value === "string" ? value.trim() : "");
const isBlank = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "");
const firstPresent = (source, keys = []) => {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (isBlank(value)) continue;
    return value;
  }
  return undefined;
};

const parseNonNegativeInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
};

const buildTransitionalSupplierSku = ({ productId, variant, index }) => {
  const shortProductId = String(productId || "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 8);
  const variantSku = String(variant?.sku || "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 12);
  const size = String(variant?.size || "default")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 8);
  const color = String(variant?.color || "default")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 12);
  const segment = String(index + 1).padStart(2, "0");
  return `LEGACY-${shortProductId || "PRODUCT"}-${variantSku || "SKU"}-${color}-${size}-${segment}`;
};

const normalizeColors = (value) => {
  let raw = value;
  if (raw === undefined || raw === null || raw === "") return [];

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch (_err) {
      raw = [trimmed];
    }
  }

  if (!Array.isArray(raw)) return [];
  const out = raw
    .map((entry) =>
      readText(entry)
        .toLowerCase()
        .replace(/\s+/g, "_")
    )
    .filter(Boolean);
  return Array.from(new Set(out));
};

const deriveSellingPriceFromSplit = ({
  vendorPayoutCents,
  royaltyCents,
  ourShareCents,
}) => {
  if (
    !isNonNegativeInteger(vendorPayoutCents) ||
    !isNonNegativeInteger(royaltyCents) ||
    !isNonNegativeInteger(ourShareCents)
  ) {
    return null;
  }
  const total = vendorPayoutCents + royaltyCents + ourShareCents;
  if (!Number.isSafeInteger(total) || total < 0) {
    return null;
  }
  return total;
};

module.exports = {
  readText,
  isBlank,
  firstPresent,
  parseNonNegativeInt,
  buildTransitionalSupplierSku,
  normalizeColors,
  deriveSellingPriceFromSplit,
};
const { isNonNegativeInteger } = require("../../utils/economics");

