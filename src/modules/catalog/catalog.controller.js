const {
  getActiveProducts,
  getAdminProducts,
  getProductById,
  detectNewMerchFlow,
  validateNewMerch,
  validateListingPhotoFiles,
  validateProductColors,
  parseMerchMoneyToCents,
  saveProductListingPhotos,
  replaceProductListingPhotos,
  loadProductListingPhotos,
  attachListingPhotosToProducts,
} = require("./catalog.service");

const { getDb } = require("../../config/db");

const BAD_REQUEST = { error: "bad_request" };
const NOT_FOUND = { error: "product_not_found" };
const DEFAULT_VARIANT_SKU = "DEFAULT";
const DEFAULT_VARIANT_STOCK = 10;
const DEFAULT_VARIANT_SIZE = "M";
const DEFAULT_VARIANT_COLOR = "default";
const MAX_MULTIPART_BYTES = 15 * 1024 * 1024;

const parseContentDisposition = (line) => {
  const nameMatch = line.match(/name="([^"]+)"/i);
  const filenameMatch = line.match(/filename="([^"]*)"/i);
  return {
    name: nameMatch?.[1] || "",
    filename: filenameMatch?.[1] || "",
  };
};

const splitBufferBy = (buffer, delimiter) => {
  const chunks = [];
  let start = 0;
  while (start <= buffer.length) {
    const idx = buffer.indexOf(delimiter, start);
    if (idx === -1) {
      chunks.push(buffer.subarray(start));
      break;
    }
    chunks.push(buffer.subarray(start, idx));
    start = idx + delimiter.length;
  }
  return chunks;
};

const parseMultipartFormData = async (req) => {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().includes("multipart/form-data")) return null;

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return { fields: {}, filesByField: {}, parseError: "missing_boundary" };

  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_MULTIPART_BYTES) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  }).catch((error) => ({ parseError: error.message }));

  if (body?.parseError) return { fields: {}, filesByField: {}, parseError: body.parseError };

  const delimiter = Buffer.from(`--${boundary}`);
  const rawParts = splitBufferBy(body, delimiter);
  const fields = {};
  const filesByField = {};

  for (const rawPart of rawParts) {
    if (!rawPart || rawPart.length === 0) continue;

    let part = rawPart;
    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
    if (part.length === 0) continue;
    if (part.subarray(0, 2).toString() === "--") continue;

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) continue;

    const headerText = part.subarray(0, headerEnd).toString("utf8");
    let content = part.subarray(headerEnd + 4);
    if (content.subarray(content.length - 2).toString() === "\r\n") {
      content = content.subarray(0, content.length - 2);
    }

    const dispositionLine = headerText
      .split("\r\n")
      .find((line) => /^content-disposition:/i.test(line));
    if (!dispositionLine) continue;

    const { name, filename } = parseContentDisposition(dispositionLine);
    if (!name) continue;

    const contentTypeLine = headerText
      .split("\r\n")
      .find((line) => /^content-type:/i.test(line));
    const mimeType = contentTypeLine
      ? contentTypeLine.split(":")[1]?.trim() || "application/octet-stream"
      : "application/octet-stream";

    if (filename) {
      const filePayload = {
        fieldname: name,
        originalname: filename,
        mimetype: mimeType,
        buffer: content,
      };
      const existing = filesByField[name];
      if (!existing) {
        filesByField[name] = filePayload;
      } else if (Array.isArray(existing)) {
        existing.push(filePayload);
      } else {
        filesByField[name] = [existing, filePayload];
      }
      continue;
    }

    fields[name] = content.toString("utf8");
  }

  return { fields, filesByField };
};

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

const withStatus = (product = {}) => ({
  ...product,
  status:
    product?.is_active === false || product?.isActive === false ? "inactive" : "active",
});

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
  const listingPhotoUrls = await loadProductListingPhotos(id);
  const prices = (Array.isArray(variants) ? variants : [])
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
    listingPhotoUrl: primaryPhotoUrl,
    photoUrls: photos,
    photos,
    primaryPhotoUrl,
    variants,
  });
};

const getRole = (user) => (user ? (user.role || user.userRole || "").toString().toLowerCase() : "");
const ADMIN_ROLES = new Set(["admin"]);
const isAdmin = (user) => ADMIN_ROLES.has(getRole(user));

const createProduct = async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const multipart = await parseMultipartFormData(req);
  if (multipart?.parseError === "payload_too_large") {
    return res.status(400).json({
      error: "validation",
      details: [{ field: "body", message: "payload too large" }],
    });
  }
  if (multipart?.parseError) {
    return res.status(400).json({
      error: "validation",
      details: [{ field: "body", message: "invalid multipart payload" }],
    });
  }

  const body = multipart?.fields || req.body || {};
  const filesByField = multipart?.filesByField || {};
  const listingPhotoValidation = validateListingPhotoFiles(filesByField, { required: false });
  if (!listingPhotoValidation.ok) {
    return res.status(400).json({ error: "validation", details: listingPhotoValidation.details });
  }
  const isNewMerchFlow = detectNewMerchFlow(body, filesByField);

  if (isNewMerchFlow) {
    const validation = validateNewMerch(body, filesByField, { requireListingPhotos: false });
    if (!validation.ok) {
      return res.status(400).json({ error: "validation", details: validation.details });
    }

    const {
      artistId,
      merchName,
      merchStory,
      mrpCents,
      vendorPayCents,
      ourShareCents,
      royaltyCents,
      merchType,
      colors,
      listingFiles,
      description,
    } = validation.value;

    try {
      const db = getDb();
      const created = await db.transaction(async (trx) => {
        const artistExists = await trx("artists").select("id").where({ id: artistId }).first();
        if (!artistExists) {
          return { validationError: { field: "artist_id", message: "artist_id does not exist" } };
        }

        const productColumns = await trx("products").columnInfo();
        const insertPayload = {
          artist_id: artistId,
          title: merchName,
          description: description || "",
          is_active: false,
          created_at: trx.fn.now(),
        };

        if (Object.prototype.hasOwnProperty.call(productColumns, "merch_story")) {
          insertPayload.merch_story = merchStory;
        }
        if (Object.prototype.hasOwnProperty.call(productColumns, "mrp_cents")) {
          insertPayload.mrp_cents = mrpCents;
        }
        if (Object.prototype.hasOwnProperty.call(productColumns, "vendor_pay_cents")) {
          insertPayload.vendor_pay_cents = vendorPayCents;
        }
        if (Object.prototype.hasOwnProperty.call(productColumns, "vendor_payout_cents")) {
          insertPayload.vendor_payout_cents = vendorPayCents;
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

        const [productRow] = await trx("products")
          .insert(insertPayload)
          .returning(["id", "created_at"]);

        const defaultVariantPrice =
          Number.isInteger(mrpCents) && mrpCents >= 0 ? mrpCents : 0;
        await trx("product_variants").insert({
          product_id: productRow.id,
          sku: buildDefaultVariantSku(productRow.id),
          size: "default",
          color: "default",
          price_cents: defaultVariantPrice,
          stock: 0,
          created_at: trx.fn.now(),
        });

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
          listingPhotoUrls,
        };
      });

      if (created?.validationError) {
        return res.status(400).json({
          error: "validation",
          details: [created.validationError],
        });
      }

      return res.status(201).json({
        ok: true,
        product_id: created.productId,
        productId: created.productId,
        created_at: created.createdAt,
        listingPhotoUrl: created.listingPhotoUrls[0] || "",
        photoUrls: created.listingPhotoUrls,
        listingPhotoUrls: created.listingPhotoUrls,
      });
    } catch (err) {
      console.error("[create_new_merch_product] failed", err);
      return res.status(500).json({ error: "internal_server_error" });
    }
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

  let listingPhotoUrls = [];
  if (Array.isArray(listingPhotoValidation.listingFiles) && listingPhotoValidation.listingFiles.length > 0) {
    try {
      await db.transaction(async (trx) => {
        const productColumns = await trx("products").columnInfo();
        listingPhotoUrls = await saveProductListingPhotos({
          trx,
          productId: productRow.id,
          files: listingPhotoValidation.listingFiles,
        });
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
      });
    } catch (err) {
      console.error("[create_product_listing_photos] failed", err);
      return res.status(500).json({ error: "internal_server_error" });
    }
  }

  const productPayload = {
    id: productRow.id,
    title: productRow.title,
    description: productRow.description,
    isActive: Boolean(productRow.isActive),
    listingPhotoUrl: listingPhotoUrls[0] || "",
    photoUrls: listingPhotoUrls,
    listingPhotoUrls,
  };

  return res.status(201).json({
    ok: true,
    id: productRow.id,
    productId: productRow.id,
    listingPhotoUrl: listingPhotoUrls[0] || "",
    photoUrls: listingPhotoUrls,
    listingPhotoUrls,
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

  const productColumns = await db("products").columnInfo();
  const hasColumn = (name) => Object.prototype.hasOwnProperty.call(productColumns, name);
  const hasAnyPayloadKey = (keys = []) =>
    keys.some((key) => Object.prototype.hasOwnProperty.call(payload, key));

  if (typeof payload.title === "string") {
    patch.title = payload.title;
  }
  if (typeof payload.merch_name === "string" || typeof payload.merchName === "string") {
    const merchName = String(payload.merch_name ?? payload.merchName).trim();
    if (merchName.length < 2) {
      return res.status(400).json({
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
      return res.status(400).json({
        error: "validation",
        details: [{ field: "merch_story", message: "merch_story must be at least 10 characters" }],
      });
    }
    patch.merch_story = merchStory;
  }
  if (hasColumn("merch_type") && (typeof payload.merch_type === "string" || typeof payload.merchType === "string")) {
    const merchType = String(payload.merch_type ?? payload.merchType).trim();
    if (!merchType) {
      return res.status(400).json({
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
      return res.status(400).json({
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
      return res.status(400).json({
        error: "validation",
        details: [{ field: "mrp_cents", message: "mrp_cents/merch_mrp must be a number greater than 0" }],
      });
    }
    patch.mrp_cents = mrpParsed.value;
  }

  if (
    (hasColumn("vendor_pay_cents") || hasColumn("vendor_payout_cents")) &&
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
      return res.status(400).json({
        error: "validation",
        details: [
          { field: "vendor_pay_cents", message: "vendor_pay_cents/vendor_pay must be a number >= 0" },
        ],
      });
    }
    if (hasColumn("vendor_pay_cents")) {
      patch.vendor_pay_cents = vendorPayParsed.value;
    }
    if (hasColumn("vendor_payout_cents")) {
      patch.vendor_payout_cents = vendorPayParsed.value;
    }
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
      return res.status(400).json({
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
      return res.status(400).json({
        error: "validation",
        details: [{ field: "royalty_cents", message: "royalty_cents/royalty must be a number >= 0" }],
      });
    }
    patch.royalty_cents = royaltyParsed.value;
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

const updateProductPhotos = async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { id } = req.params;
  if (!id) {
    return res.status(400).json(BAD_REQUEST);
  }

  const multipart = await parseMultipartFormData(req);
  if (multipart?.parseError === "payload_too_large") {
    return res.status(400).json({
      error: "validation",
      details: [{ field: "body", message: "payload too large" }],
    });
  }
  if (multipart?.parseError) {
    return res.status(400).json({
      error: "validation",
      details: [{ field: "body", message: "invalid multipart payload" }],
    });
  }

  const filesByField = multipart?.filesByField || {};
  const listingValidation = validateListingPhotoFiles(filesByField, { required: true });
  if (!listingValidation.ok) {
    return res.status(400).json({ error: "validation", details: listingValidation.details });
  }

  const db = getDb();
  const existing = await db("products").select("id").where({ id }).first();
  if (!existing) {
    return res.status(404).json(NOT_FOUND);
  }

  try {
    const result = await db.transaction(async (trx) => {
      const productColumns = await trx("products").columnInfo();
      const listingPhotoUrls = await replaceProductListingPhotos({
        trx,
        productId: id,
        files: listingValidation.listingFiles,
      });

      if (Object.prototype.hasOwnProperty.call(productColumns, "listing_photos")) {
        await trx("products")
          .where({ id })
          .update({
            listing_photos: trx.raw("?::jsonb", [JSON.stringify(listingPhotoUrls)]),
          });
      }

      return { listingPhotoUrls };
    });

    return res.json({
      ok: true,
      product_id: id,
      productId: id,
      listingPhotoUrls: result.listingPhotoUrls,
    });
  } catch (err) {
    console.error("[update_product_photos] failed", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
};

module.exports = {
  listProducts,
  listArtistProducts,
  getProduct,
  createProduct,
  updateProduct,
  updateProductPhotos,
};
