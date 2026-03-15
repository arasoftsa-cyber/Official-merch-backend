const {
  normalizeProductPrice,
  asUuidOrNull,
} = require("../normalizers");
const {
  normalizeProductStatusValue,
  statusFromIsActive,
} = require("../status");

const DEFAULT_VARIANT_STOCK = 0;
const DEFAULT_VARIANT_SIZE = "M";
const DEFAULT_VARIANT_COLOR = "default";

const isHttpError = (value) => Boolean(value && value.__httpError);

const makeHttpError = (status, payload) => ({
  __httpError: true,
  status,
  payload,
});

const parseMultipartPayload = (req, multipart) => ({
  body: multipart?.fields || req.body || {},
  filesByField: multipart?.filesByField || {},
});

const validateCreateProductInput = ({ body, fallbackBody }) => {
  const {
    title,
    description,
    status,
    isActive,
    price: bodyPrice,
    priceCents: bodyPriceCentsInput,
    stock: bodyStockInput,
    size: bodySize,
    color: bodyColor,
    sku: bodySku,
    inventorySkuId: bodyInventorySkuId,
    inventory_sku_id: bodyInventorySkuIdSnake,
    supplierSku: bodySupplierSku,
    supplier_sku: bodySupplierSkuSnake,
  } = body;

  if (!title || typeof title !== "string") {
    return makeHttpError(400, { error: "bad_request" });
  }

  const bodyPriceCents =
    typeof bodyPriceCentsInput !== "undefined" && bodyPriceCentsInput !== null
      ? bodyPriceCentsInput
      : body.price_cents;

  const variantInput =
    (Array.isArray(body.variants) && body.variants.length ? body.variants[0] : null) ||
    body.variant ||
    {};

  const sizeCandidate =
    typeof variantInput?.size !== "undefined" ? variantInput.size : bodySize;
  const colorCandidate =
    typeof variantInput?.color !== "undefined" ? variantInput.color : bodyColor;
  const normalizedSize =
    typeof sizeCandidate === "string"
      ? sizeCandidate.trim() || DEFAULT_VARIANT_SIZE
      : typeof sizeCandidate === "number"
      ? String(sizeCandidate)
      : DEFAULT_VARIANT_SIZE;
  const normalizedColor =
    typeof colorCandidate === "string"
      ? colorCandidate.trim() || DEFAULT_VARIANT_COLOR
      : typeof colorCandidate === "number"
      ? String(colorCandidate)
      : DEFAULT_VARIANT_COLOR;

  const variantStockSource =
    typeof variantInput?.stock !== "undefined"
      ? variantInput.stock
      : typeof bodyStockInput !== "undefined"
      ? bodyStockInput
      : body.stock;
  let variantStock = DEFAULT_VARIANT_STOCK;
  if (variantStockSource !== undefined && variantStockSource !== null) {
    const stockNumber = Number(variantStockSource);
    if (!Number.isFinite(stockNumber) || !Number.isInteger(stockNumber) || stockNumber < 0) {
      return makeHttpError(400, { error: "invalid_stock" });
    }
    variantStock = stockNumber;
  }

  const variantPriceCentsInput =
    variantInput?.priceCents ?? variantInput?.price_cents ?? bodyPriceCents;
  const variantPriceInput =
    typeof variantInput?.price !== "undefined" ? variantInput.price : bodyPrice;

  const priceResult = normalizeProductPrice({
    price: variantPriceInput,
    priceCents: variantPriceCentsInput,
    requirePrice: true,
  });
  if (priceResult.error) {
    return makeHttpError(400, { error: priceResult.error });
  }

  const artistId = body.artistId ?? fallbackBody?.artistId;
  if (!artistId) {
    return makeHttpError(400, { error: "bad_request" });
  }

  const rawInventorySkuId =
    variantInput?.inventorySkuId ??
    variantInput?.inventory_sku_id ??
    bodyInventorySkuId ??
    bodyInventorySkuIdSnake;
  const inventorySkuIdFromPayload = asUuidOrNull(rawInventorySkuId);
  if (rawInventorySkuId && !inventorySkuIdFromPayload) {
    return makeHttpError(400, { error: "invalid_inventory_sku_id" });
  }

  const isActiveFlag =
    typeof isActive === "boolean"
      ? isActive
      : status === "inactive"
      ? false
      : status === "active"
      ? true
      : true;
  const requestedStatus = normalizeProductStatusValue(status);
  if (typeof status === "string" && !requestedStatus) {
    return makeHttpError(400, {
      error: "validation",
      details: [{ field: "status", message: "status must be pending, inactive, active, or rejected" }],
    });
  }

  return {
    title,
    description,
    status,
    body,
    variantInput,
    bodySku,
    bodySupplierSku,
    bodySupplierSkuSnake,
    normalizedSize,
    normalizedColor,
    variantStock,
    priceResult,
    artistId,
    inventorySkuIdFromPayload,
    isActiveFlag,
    resolvedStatus: requestedStatus || statusFromIsActive(isActiveFlag),
  };
};

const validateUpdateProductInput = ({ id, payload }) => {
  if (!id) {
    return makeHttpError(400, { error: "bad_request" });
  }
  return { id, payload: payload || {} };
};

const validateUpdateProductPhotosInput = ({ id }) => {
  if (!id) {
    return makeHttpError(400, { error: "bad_request" });
  }
  return { id };
};

module.exports = {
  isHttpError,
  makeHttpError,
  parseMultipartPayload,
  validateCreateProductInput,
  validateUpdateProductInput,
  validateUpdateProductPhotosInput,
};
