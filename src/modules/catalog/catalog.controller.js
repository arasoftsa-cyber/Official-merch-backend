const {
  getActiveProducts,
  getProductById,
  createProductWithVariants,
} = require("./catalog.service");

const { getDb } = require("../../config/db");

const BAD_REQUEST = { error: "bad_request" };
const NOT_FOUND = { error: "product_not_found" };
const DEFAULT_VARIANT_SKU = "DEFAULT";
const DEFAULT_VARIANT_STOCK = 10;
const DEFAULT_VARIANT_SIZE = "M";
const DEFAULT_VARIANT_COLOR = "default";

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

const listProducts = async (req, res) => {
  const items = await getActiveProducts();
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

  const items = await db("products")
    .select(
      "id",
      "title",
      "description",
      "created_at as createdAt",
      "created_at as updatedAt",
      "artist_id as artistId",
      "is_active",
      "is_active as isActive",
      db.raw("is_active as active"),
      db.raw(
        "(select min(price_cents) from product_variants v where v.product_id = products.id) as minVariantPriceCents"
      )
    )
    .where({ artist_id: mapping.artist_id })
    .orderBy("created_at", "desc");

  return res.json({ items });
};

const getProduct = async (req, res) => {
  const { id } = req.params;
  const row = await getProductById(id);
  if (!row) {
    return res.status(404).json(NOT_FOUND);
  }
  const { product, variants } = row;
  return res.json({ product, variants });
};

const getRole = (user) => (user ? (user.role || user.userRole || "").toString().toLowerCase() : "");
const ARTIST_ROLES = new Set(["artist"]);
const ADMIN_ROLES = new Set(["admin"]);
const isArtist = (user) => ARTIST_ROLES.has(getRole(user));
const isAdmin = (user) => ADMIN_ROLES.has(getRole(user));

const createProduct = async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "forbidden" });
  }
  console.log(
    "[DBG products POST]",
    "file=catalog.controller.js",
    "role=",
    req.user?.role || req.user?.userRole,
    "userId=",
    req.user?.id,
    "url=",
    req.originalUrl
  );
  const body = req.body || {};
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
  } = body;
  if (!title || typeof title !== "string") {
    return res.status(400).json(BAD_REQUEST);
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
      return res.status(400).json({ error: "invalid_stock" });
    }
    variantStock = stockNumber;
  }

  const variantPriceCentsInput =
    variantInput?.priceCents ?? variantInput?.price_cents ?? bodyPriceCents;
  const variantPriceInput = typeof variantInput?.price !== "undefined" ? variantInput.price : bodyPrice;

  const priceResult = normalizeProductPrice({
    price: variantPriceInput,
    priceCents: variantPriceCentsInput,
    requirePrice: true,
  });
  if (priceResult.error) {
    return res.status(400).json({ error: priceResult.error });
  }

  let artistId = body.artistId ?? req.body?.artistId;

  if (!artistId) {
    return res.status(400).json(BAD_REQUEST);
  }

  const isActiveFlag =
    typeof isActive === "boolean"
      ? isActive
      : status === "inactive"
      ? false
      : status === "active"
      ? true
      : true;
  const db = getDb();
  const [productRow] = await db("products")
    .insert({
      artist_id: artistId,
      title,
      description: description || null,
      is_active: isActiveFlag,
      created_at: db.fn.now(),
    })
    .returning(["id", "title", "description", "is_active as isActive"]);

  if (!productRow) {
    return res.status(500).json({ error: "internal_server_error" });
  }

  const skuCandidate = variantInput?.sku ?? bodySku;
  const sanitizedSku = sanitizeSkuSegment(skuCandidate);
  const baseSku =
    sanitizedSku ||
    buildDefaultSku(productRow.id, normalizedSize, normalizedColor) ||
    DEFAULT_VARIANT_SKU;

  const randomSuffix = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  let variantRow = null;
  let attempt = 0;
  while (attempt < 3 && !variantRow) {
    const sku = `${baseSku}${attempt ? `-${randomSuffix()}` : ''}`;
    try {
      const [inserted] = await db("product_variants")
        .insert({
          product_id: productRow.id,
          sku,
          size: normalizedSize,
          color: normalizedColor,
          price_cents: priceResult.priceCents,
          stock: variantStock,
          created_at: db.fn.now(),
        })
        .returning([
          "id",
          "sku",
          "size",
          "color",
          "price_cents as priceCents",
          "stock",
        ]);
      variantRow = inserted;
    } catch (err) {
      if (err?.code === "23505" || err?.message?.includes("duplicate key")) {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }

  if (!variantRow) {
    return res.status(500).json({ error: "internal_server_error", message: "variant_sku_conflict" });
  }

  const productPayload = {
    id: productRow.id,
    title: productRow.title,
    description: productRow.description,
    isActive: Boolean(productRow.isActive),
  };

  return res.status(201).json({
    ok: true,
    id: productRow.id,
    productId: productRow.id,
    product: productPayload,
    defaultVariant: variantRow
      ? {
          id: variantRow.id,
          sku: variantRow.sku,
          size: variantRow.size,
          color: variantRow.color,
          priceCents: variantRow.priceCents,
          stock: variantRow.stock,
        }
      : null,
  });
};

const updateProduct = async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json(BAD_REQUEST);
  }

  const payload = req.body || {};
  const db = getDb();
  const patch = {};
  const role = getRole(req.user);
  const userId = req.user?.id;
  const artistPayloadKeys = new Set(["isActive", "status", "active"]);

  if (role === "artist") {
    const payloadKeys = Object.keys(payload || {});
    if (
      payloadKeys.length === 0 ||
      payloadKeys.some((key) => !artistPayloadKeys.has(key))
    ) {
      return res.status(403).json({ error: "forbidden" });
    }

    const mapping = await db("artist_user_map")
      .select("artist_id")
      .where({ user_id: userId })
      .first();
    if (!mapping?.artist_id) {
      return res.status(403).json({ error: "forbidden" });
    }

    const ownedProduct = await db("products")
      .select("id")
      .where({ id, artist_id: mapping.artist_id })
      .first();
    if (!ownedProduct) {
      return res.status(403).json({ error: "forbidden" });
    }
  }

  if (typeof payload.title === "string") {
    patch.title = payload.title;
  }
  if (typeof payload.description === "string") {
    patch.description = payload.description;
  }
  if (typeof payload.active === "boolean") {
    patch.is_active = payload.active;
  } else if (typeof payload.isActive === "boolean") {
    patch.is_active = payload.isActive;
  } else if (typeof payload.status === "string") {
    patch.is_active = payload.status === "active";
  }

  const variantPayloadInput = Array.isArray(payload.variants)
    ? payload.variants
    : payload.variant
    ? [payload.variant]
    : [];
  const variantPayloads = variantPayloadInput.filter(Boolean);

  if (role === "artist" && variantPayloads.length > 0) {
    return res.status(403).json({ error: "forbidden" });
  }

  const hasProductFields = Object.keys(patch).length > 0;
  const hasVariantUpdates = variantPayloads.length > 0;
  if (!hasProductFields && !hasVariantUpdates) {
    return res.status(400).json({ error: "no_fields" });
  }

  if (Object.keys(patch).length > 0) {
    const updatedRows = await db("products")
      .where({ id })
      .update(patch)
      .returning(["id", "title", "description", "is_active as isActive"]);
    if (!updatedRows || updatedRows.length === 0) {
      return res.status(404).json(NOT_FOUND);
    }
  }

  const productRow = await db("products")
    .select("id", "title", "description", "is_active as isActive")
    .where({ id })
    .first();
  if (!productRow) {
    return res.status(404).json(NOT_FOUND);
  }

  if (hasVariantUpdates) {
    for (const variantUpdate of variantPayloads) {
      const variantId =
        variantUpdate?.id || variantUpdate?.variantId || variantUpdate?.variant_id;
      if (!variantId) {
        return res.status(400).json({ error: "missing_variant_id" });
      }

      const variantRow = await db("product_variants")
        .select("id")
        .where({ id: variantId, product_id: id })
        .first();
      if (!variantRow) {
        return res.status(404).json({ error: "variant_not_found" });
      }

      const variantPatch = {};

      if (
        typeof variantUpdate.price !== "undefined" ||
        typeof variantUpdate.priceCents !== "undefined"
      ) {
        const priceResult = normalizeProductPrice({
          price: variantUpdate.price,
          priceCents: variantUpdate.priceCents,
          requirePrice: false,
        });
        if (priceResult.error) {
          return res.status(400).json({ error: priceResult.error });
        }
        if (typeof priceResult.priceCents === "number") {
          variantPatch.price_cents = priceResult.priceCents;
        }
      }

      if (typeof variantUpdate.stock !== "undefined" && variantUpdate.stock !== null) {
        const stockNumber = Number(variantUpdate.stock);
        if (!Number.isFinite(stockNumber) || !Number.isInteger(stockNumber) || stockNumber < 0) {
          return res.status(400).json({ error: "invalid_stock" });
        }
        variantPatch.stock = stockNumber;
      }

      if (Object.keys(variantPatch).length === 0) {
        continue;
      }

      await db("product_variants").where({ id: variantId }).update(variantPatch);
    }
  }

  const loadPrimaryVariant = () =>
    db("product_variants")
      .select(
        "id",
        "sku",
        "size",
        "color",
        "price_cents as priceCents",
        "stock"
      )
      .where({ product_id: id })
      .orderBy("created_at", "asc")
      .first();

  const primaryVariant = await loadPrimaryVariant();

  return res.json({
    product: {
      id: productRow.id,
      title: productRow.title,
      description: productRow.description,
      isActive: Boolean(productRow.isActive),
    },
    defaultVariant: primaryVariant
      ? {
          id: primaryVariant.id,
          sku: primaryVariant.sku,
          size: primaryVariant.size,
          color: primaryVariant.color,
          priceCents: primaryVariant.priceCents,
          stock: primaryVariant.stock,
        }
      : null,
  });
};

module.exports = {
  listProducts,
  listArtistProducts,
  getProduct,
  createProduct,
  updateProduct,
};
