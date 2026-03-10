const {
  getActiveProducts,
  getAdminProducts,
  getProductById,
  detectNewMerchFlow,
  validateNewMerch,
  validateListingPhotoFiles,
  validateDesignImageFile,
  normalizeSkuTypes,
  validateProductColors,
  parseMerchMoneyToCents,
  saveProductListingPhotos,
  saveProductDesignImage,
  replaceProductListingPhotos,
  loadProductListingPhotos,
  loadProductDesignImage,
  loadProductDesignImagesMap,
  attachListingPhotosToProducts,
} = require("../services/catalog.service");
const {
  buildSellableMinPriceSubquery,
  buildVariantInventoryQuery,
  formatVariantInventoryRow,
} = require("../services/variantAvailability.service");
const { resolveOurShareCents } = require("../utils/economics");

const { getDb } = require("../core/db/db");
const { getTableColumns } = require("../core/db/schemaCache");

const BAD_REQUEST = { error: "bad_request" };
const NOT_FOUND = { error: "product_not_found" };
const DEFAULT_VARIANT_SKU = "DEFAULT";
const DEFAULT_VARIANT_STOCK = 0;
const DEFAULT_VARIANT_SIZE = "M";
const DEFAULT_VARIANT_COLOR = "default";
const MAX_MULTIPART_BYTES = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_STATUS_PENDING = "pending";
const PRODUCT_STATUS_INACTIVE = "inactive";
const PRODUCT_STATUS_ACTIVE = "active";
const PRODUCT_STATUS_REJECTED = "rejected";
const PRODUCT_STATUS_VALUES = new Set([
  PRODUCT_STATUS_PENDING,
  PRODUCT_STATUS_INACTIVE,
  PRODUCT_STATUS_ACTIVE,
  PRODUCT_STATUS_REJECTED,
]);

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

const normalizeProductStatusValue = (rawValue) => {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.trim().toLowerCase();
  if (!PRODUCT_STATUS_VALUES.has(normalized)) return null;
  return normalized;
};

const statusFromIsActive = (isActive) =>
  isActive ? PRODUCT_STATUS_ACTIVE : PRODUCT_STATUS_INACTIVE;

const normalizeProductStatusFromRecord = (product = {}) => {
  const statusFromColumn = normalizeProductStatusValue(product?.status);
  if (statusFromColumn) return statusFromColumn;
  if (product?.is_active === false || product?.isActive === false) {
    return PRODUCT_STATUS_INACTIVE;
  }
  return PRODUCT_STATUS_ACTIVE;
};

const canArtistToggleProductStatus = (existingStatus, requestedStatus = null) => {
  const existingAllowed =
    existingStatus === PRODUCT_STATUS_ACTIVE || existingStatus === PRODUCT_STATUS_INACTIVE;
  if (!existingAllowed) return false;
  if (!requestedStatus) return true;
  return (
    requestedStatus === PRODUCT_STATUS_ACTIVE ||
    requestedStatus === PRODUCT_STATUS_INACTIVE
  );
};

const canAdminPatchProductStatus = (existingStatus, requestedStatus = null) => {
  const existingAllowed =
    existingStatus === PRODUCT_STATUS_ACTIVE || existingStatus === PRODUCT_STATUS_INACTIVE;
  if (!existingAllowed) return false;
  if (!requestedStatus) return true;
  return (
    requestedStatus === PRODUCT_STATUS_ACTIVE ||
    requestedStatus === PRODUCT_STATUS_INACTIVE
  );
};

const withStatus = (product = {}) => ({
  ...product,
  status: normalizeProductStatusFromRecord(product),
});

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

  const productColumns = await getTableColumns(db, "products");
  const selections = [
    "id",
    "title",
    "description",
    "created_at as createdAt",
    "created_at as updatedAt",
    "artist_id as artistId",
    "is_active",
    "is_active as isActive",
    db.raw("is_active as active"),
    buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\""),
  ];
  if (Object.prototype.hasOwnProperty.call(productColumns, "status")) {
    selections.push("status");
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "rejection_reason")) {
    selections.push("rejection_reason as rejectionReason");
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "sku_types")) {
    selections.push("sku_types as skuTypes");
  }

  const artistProductsQuery = db("products")
    .select(selections)
    .where({ artist_id: mapping.artist_id })
    .orderBy("created_at", "desc");
  const rows = await artistProductsQuery;
  const designImageMap = await loadProductDesignImagesMap(rows.map((row) => row.id));
  const items = rows.map((row) => {
    const designImageUrl = designImageMap.get(row.id) || "";
    return withStatus({
      ...row,
      designImageUrl,
      design_image_url: designImageUrl,
      skuTypes: Array.isArray(row.skuTypes) ? row.skuTypes : [],
      sku_types: Array.isArray(row.skuTypes) ? row.skuTypes : [],
    });
  });

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
  const designImageUrl = await loadProductDesignImage(id);
  const isAdminView = isAdmin(req.user);
  const productStatus = normalizeProductStatusFromRecord(product);
  if (!isAdminView) {
    const hasStatusColumn = Object.prototype.hasOwnProperty.call(product || {}, "status");
    if (hasStatusColumn) {
      const explicitStatus = normalizeProductStatusValue(product?.status);
      if (explicitStatus !== PRODUCT_STATUS_ACTIVE) {
        return res.status(404).json(NOT_FOUND);
      }
    } else if (productStatus !== PRODUCT_STATUS_ACTIVE) {
      return res.status(404).json(NOT_FOUND);
    }
  }
  const allVariants = Array.isArray(variants) ? variants : [];
  const sellableVariants = allVariants.filter((variant) => Boolean(variant?.effectiveSellable));
  const responseVariants = allVariants;
  const pricingSource = sellableVariants.length > 0 ? sellableVariants : responseVariants;
  const prices = pricingSource
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
    status: productStatus,
    rejection_reason: product?.rejection_reason ?? null,
    rejectionReason: product?.rejection_reason ?? null,
    sku_types: Array.isArray(product?.sku_types) ? product.sku_types : [],
    skuTypes: Array.isArray(product?.sku_types) ? product.sku_types : [],
    design_image_url: designImageUrl,
    designImageUrl,
    listing_photos: photos,
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
    listing_photos: photos,
    design_image_url: designImageUrl,
    designImageUrl,
    listingPhotoUrl: primaryPhotoUrl,
    photoUrls: photos,
    photos,
    primaryPhotoUrl,
    variants: responseVariants,
  });
};

const getRole = (user) => (user ? (user.role || user.userRole || "").toString().toLowerCase() : "");
const ADMIN_ROLES = new Set(["admin"]);
const isAdmin = (user) => ADMIN_ROLES.has(getRole(user));
const isArtist = (user) => getRole(user) === "artist";

const resolveArtistIdForUser = async (db, userId) => {
  if (!userId) return null;
  const mapping = await db("artist_user_map")
    .select("artist_id")
    .where({ user_id: userId })
    .first();
  return mapping?.artist_id || null;
};

const parseOnboardingSkuTypes = (body = {}) => {
  const rawSkuTypes =
    body?.sku_types ??
    body?.skuTypes ??
    body?.sku_types_json ??
    body?.skuTypesJson ??
    null;
  const normalized = normalizeSkuTypes(rawSkuTypes);
  if (normalized.invalid.length > 0) {
    return {
      ok: false,
      details: [
        {
          field: "sku_types",
          message: `Unsupported SKU type(s): ${normalized.invalid.join(", ")}`,
        },
      ],
    };
  }
  if (normalized.skuTypes.length < 1) {
    return {
      ok: false,
      details: [
        {
          field: "sku_types",
          message: "Select at least one SKU type.",
        },
      ],
    };
  }
  return { ok: true, skuTypes: normalized.skuTypes };
};

const createArtistOnboardingRequest = async (req, res) => {
  if (!isArtist(req.user)) {
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
  const merchName = String(body.merch_name ?? body.merchName ?? body.title ?? "").trim();
  const merchStory = String(body.merch_story ?? body.merchStory ?? "").trim();

  const validationDetails = [];
  if (!merchName) {
    validationDetails.push({
      field: "merch_name",
      message: "Merch name is required.",
    });
  }
  if (!merchStory) {
    validationDetails.push({
      field: "merch_story",
      message: "Merch story is required.",
    });
  }

  const skuTypeValidation = parseOnboardingSkuTypes(body);
  if (!skuTypeValidation.ok) validationDetails.push(...skuTypeValidation.details);

  const designValidation = validateDesignImageFile(filesByField, { required: true });
  if (!designValidation.ok) validationDetails.push(...designValidation.details);

  if (validationDetails.length > 0) {
    return res.status(400).json({ error: "validation", details: validationDetails });
  }

  const db = getDb();
  const artistId = await resolveArtistIdForUser(db, req.user?.id);
  if (!artistId) {
    return res.status(403).json({ error: "forbidden" });
  }

  try {
    const created = await db.transaction(async (trx) => {
      const productColumns = await trx("products").columnInfo();
      const insertPayload = {
        artist_id: artistId,
        title: merchName,
        description: merchStory,
        is_active: false,
        created_at: trx.fn.now(),
      };
      if (Object.prototype.hasOwnProperty.call(productColumns, "merch_story")) {
        insertPayload.merch_story = merchStory;
      }
      if (Object.prototype.hasOwnProperty.call(productColumns, "status")) {
        insertPayload.status = PRODUCT_STATUS_PENDING;
      }
      if (Object.prototype.hasOwnProperty.call(productColumns, "rejection_reason")) {
        insertPayload.rejection_reason = null;
      }
      if (Object.prototype.hasOwnProperty.call(productColumns, "sku_types")) {
        insertPayload.sku_types = trx.raw("?::jsonb", [JSON.stringify(skuTypeValidation.skuTypes)]);
      }

      const [productRow] = await trx("products")
        .insert(insertPayload)
        .returning(["id", "created_at"]);

      const designImageUrl = await saveProductDesignImage({
        trx,
        productId: productRow.id,
        file: designValidation.designFile,
      });

      return {
        id: productRow.id,
        createdAt: productRow.created_at,
        designImageUrl,
      };
    });

    return res.status(201).json({
      ok: true,
      product_id: created.id,
      productId: created.id,
      status: PRODUCT_STATUS_PENDING,
      designImageUrl: created.designImageUrl,
      created_at: created.createdAt,
    });
  } catch (err) {
    console.error("[create_artist_onboarding_request] failed", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
};

const listAdminOnboardingRequests = async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const requestedStatus = normalizeProductStatusValue(String(req.query?.status || "").trim());
  const statusFilter = requestedStatus || PRODUCT_STATUS_PENDING;

  const db = getDb();
  const productColumns = await getTableColumns(db, "products");
  const hasStatus = Object.prototype.hasOwnProperty.call(productColumns, "status");
  const hasRejectionReason = Object.prototype.hasOwnProperty.call(
    productColumns,
    "rejection_reason"
  );
  const hasSkuTypes = Object.prototype.hasOwnProperty.call(productColumns, "sku_types");
  if (!hasStatus) {
    return res.json({ items: [] });
  }

  const selections = [
    "p.id as id",
    "p.artist_id as artistId",
    "a.name as artistName",
    "a.handle as artistHandle",
    "p.title as title",
    "p.description as description",
    "p.status as status",
    "p.is_active as isActive",
    "p.created_at as createdAt",
  ];
  if (hasRejectionReason) {
    selections.push("p.rejection_reason as rejectionReason");
  }
  if (hasSkuTypes) {
    selections.push("p.sku_types as skuTypes");
  }

  const rows = await db("products as p")
    .leftJoin("artists as a", "a.id", "p.artist_id")
    .select(selections)
    .where("p.status", statusFilter)
    .orderBy("p.created_at", "asc");

  const itemsWithListingPhotos = await attachListingPhotosToProducts(rows);
  const designImageMap = await loadProductDesignImagesMap(rows.map((row) => row.id));
  const items = itemsWithListingPhotos.map((row) => {
    const listingPhotoUrls = Array.isArray(row.listingPhotoUrls)
      ? row.listingPhotoUrls
      : [];
    const designImageUrl = designImageMap.get(row.id) || "";
    return withStatus({
      ...row,
      artistName: row.artistName || "",
      artistHandle: row.artistHandle || "",
      listing_photos: listingPhotoUrls,
      listingPhotoUrls,
      designImageUrl,
      design_image_url: designImageUrl,
      skuTypes: Array.isArray(row.skuTypes) ? row.skuTypes : [],
      sku_types: Array.isArray(row.skuTypes) ? row.skuTypes : [],
    });
  });

  return res.json({ items });
};

const approveOnboardingRequest = async (req, res) => {
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
  const listingValidation = validateListingPhotoFiles(filesByField, {
    required: true,
    minFiles: 4,
    maxFiles: 6,
    maxIndexedField: 6,
  });
  if (!listingValidation.ok) {
    return res.status(400).json({ error: "validation", details: listingValidation.details });
  }
  const approveAllowedMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png"]);
  const invalidApprovalFiles = (Array.isArray(listingValidation.listingFiles) ? listingValidation.listingFiles : []).filter(
    (file) => {
      const mime = String(file?.mimetype || "").toLowerCase().trim();
      const filename = String(file?.originalname || "").toLowerCase().trim();
      const extensionAllowed = /\.(jpe?g|png)$/i.test(filename);
      const mimeAllowed = mime ? approveAllowedMimeTypes.has(mime) : false;
      return !(mimeAllowed || extensionAllowed);
    }
  );
  if (invalidApprovalFiles.length > 0) {
    return res.status(400).json({
      error: "validation",
      details: [
        {
          field: "listing_photos",
          message: "marketplace images must be JPG or PNG",
        },
      ],
    });
  }

  const db = getDb();
  const existingProduct = await db("products").where({ id }).first();
  if (!existingProduct) {
    return res.status(404).json(NOT_FOUND);
  }
  const existingStatus = normalizeProductStatusFromRecord(existingProduct);
  if (existingStatus !== PRODUCT_STATUS_PENDING) {
    return res.status(400).json({
      error: "invalid_status_transition",
      message: "Only pending requests can be approved.",
    });
  }

  try {
    const result = await db.transaction(async (trx) => {
      const productColumns = await trx("products").columnInfo();
      const listingPhotoUrls = await replaceProductListingPhotos({
        trx,
        productId: id,
        files: listingValidation.listingFiles,
      });

      const patch = {
        is_active: false,
      };
      if (Object.prototype.hasOwnProperty.call(productColumns, "status")) {
        patch.status = PRODUCT_STATUS_INACTIVE;
      }
      if (Object.prototype.hasOwnProperty.call(productColumns, "rejection_reason")) {
        patch.rejection_reason = null;
      }
      if (Object.prototype.hasOwnProperty.call(productColumns, "listing_photos")) {
        patch.listing_photos = trx.raw("?::jsonb", [JSON.stringify(listingPhotoUrls)]);
      }
      await trx("products").where({ id }).update(patch);
      return { listingPhotoUrls };
    });

    return res.json({
      ok: true,
      product_id: id,
      productId: id,
      status: PRODUCT_STATUS_INACTIVE,
      listingPhotoUrls: result.listingPhotoUrls,
      listingPhotoUrl: result.listingPhotoUrls[0] || "",
    });
  } catch (err) {
    console.error("[approve_onboarding_request] failed", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
};

const rejectOnboardingRequest = async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { id } = req.params;
  if (!id) {
    return res.status(400).json(BAD_REQUEST);
  }

  const payload = req.body || {};
  const rejectionReasonRaw = payload.rejection_reason ?? payload.rejectionReason;
  const rejectionReason =
    rejectionReasonRaw === undefined || rejectionReasonRaw === null
      ? null
      : String(rejectionReasonRaw).trim() || null;

  const db = getDb();
  const productColumns = await db("products").columnInfo();
  const existing = await db("products").where({ id }).first();
  if (!existing) {
    return res.status(404).json(NOT_FOUND);
  }
  const existingStatus = normalizeProductStatusFromRecord(existing);
  if (existingStatus !== PRODUCT_STATUS_PENDING) {
    return res.status(400).json({
      error: "invalid_status_transition",
      message: "Only pending requests can be rejected.",
    });
  }

  const patch = { is_active: false };
  if (Object.prototype.hasOwnProperty.call(productColumns, "status")) {
    patch.status = PRODUCT_STATUS_REJECTED;
  }
  if (Object.prototype.hasOwnProperty.call(productColumns, "rejection_reason")) {
    patch.rejection_reason = rejectionReason;
  }

  await db("products").where({ id }).update(patch);
  return res.json({
    ok: true,
    product_id: id,
    productId: id,
    status: PRODUCT_STATUS_REJECTED,
    rejection_reason: rejectionReason,
    rejectionReason,
  });
};

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
      sellingPriceCents,
      vendorPayoutCents,
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

        const [productColumns, variantColumns] = await Promise.all([
          trx("products").columnInfo(),
          trx("product_variants").columnInfo(),
        ]);
        const hasVariantColumn = (name) =>
          Object.prototype.hasOwnProperty.call(variantColumns, name);
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
        status: created.status || PRODUCT_STATUS_INACTIVE,
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
    inventorySkuId: bodyInventorySkuId,
    inventory_sku_id: bodyInventorySkuIdSnake,
    supplierSku: bodySupplierSku,
    supplier_sku: bodySupplierSkuSnake,
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

  const rawInventorySkuId =
    variantInput?.inventorySkuId ??
    variantInput?.inventory_sku_id ??
    bodyInventorySkuId ??
    bodyInventorySkuIdSnake;
  const inventorySkuIdFromPayload = asUuidOrNull(rawInventorySkuId);
  if (rawInventorySkuId && !inventorySkuIdFromPayload) {
    return res.status(400).json({ error: "invalid_inventory_sku_id" });
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
    return res.status(400).json({
      error: "validation",
      details: [{ field: "status", message: "status must be pending, inactive, active, or rejected" }],
    });
  }
  const resolvedStatus = requestedStatus || statusFromIsActive(isActiveFlag);
  const db = getDb();
  let productRow = null;
  let variantRow = null;

  try {
    const created = await db.transaction(async (trx) => {
      const [productColumns, variantColumns, skuColumns] = await Promise.all([
        trx("products").columnInfo(),
        trx("product_variants").columnInfo(),
        trx("inventory_skus").columnInfo(),
      ]);
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
            // Compatibility mirror only; source of truth is inventory_skus.stock.
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
    });

    productRow = created.productRow;
    variantRow = created.variantRow;
  } catch (err) {
    if (err?.code === "INVENTORY_SKU_NOT_FOUND") {
      return res.status(400).json({ error: "inventory_sku_not_found" });
    }
    if (err?.code === "INVALID_VARIANT_ECONOMICS") {
      return res.status(400).json({ error: err?.message || "invalid_variant_economics" });
    }
    if (err?.code === "VARIANT_SKU_CONFLICT") {
      return res.status(500).json({ error: "internal_server_error", message: "variant_sku_conflict" });
    }
    console.error("[create_product] failed", err);
    return res.status(500).json({ error: "internal_server_error" });
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
    status: normalizeProductStatusFromRecord(productRow),
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
    defaultVariant: variantRow || null,
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
  const variantColumns = await db("product_variants").columnInfo();
  const hasVariantColumn = (name) => Object.prototype.hasOwnProperty.call(variantColumns, name);
  const hasAnyPayloadKey = (keys = []) =>
    keys.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  const existingProduct = await db("products").where({ id }).first();
  if (!existingProduct) {
    return res.status(404).json(NOT_FOUND);
  }
  const existingStatus = normalizeProductStatusFromRecord(existingProduct);
  if (role === "artist" && !canArtistToggleProductStatus(existingStatus, null)) {
    return res.status(403).json({ error: "forbidden" });
  }

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
      return res.status(400).json({
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
      return res.status(400).json({
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

  const hasExplicitProductOurShare = hasAnyPayloadKey([
    "our_share_cents",
    "ourShareCents",
    "our_share",
    "ourShare",
  ]);
  if (hasColumn("our_share_cents") && !hasExplicitProductOurShare) {
    const nextSellingPrice = parseNonNegativeInt(
      patch.selling_price_cents ??
        existingProduct.selling_price_cents ??
        patch.mrp_cents ??
        existingProduct.mrp_cents
    );
    const nextVendorPayout = parseNonNegativeInt(
      patch.vendor_payout_cents ?? existingProduct.vendor_payout_cents
    );
    const nextRoyalty = parseNonNegativeInt(
      patch.royalty_cents ?? existingProduct.royalty_cents
    );

    const shareResolution = resolveOurShareCents({
      sellingPriceCents: nextSellingPrice,
      vendorPayoutCents:
        nextVendorPayout === null ? undefined : nextVendorPayout,
      royaltyCents: nextRoyalty === null ? undefined : nextRoyalty,
      ourShareCents: undefined,
    });
    if (shareResolution.error) {
      return res.status(400).json({ error: shareResolution.error });
    }
    if (
      nextVendorPayout !== null &&
      nextRoyalty !== null &&
      typeof shareResolution.ourShareCents !== "number"
    ) {
      return res.status(400).json({ error: "invalid_our_share_cents" });
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
      return res.status(400).json({
        error: "validation",
        details: [{ field: "status", message: "status must be pending, inactive, active, or rejected" }],
      });
    }
  }

  if (role === "artist" && !canArtistToggleProductStatus(existingStatus, nextStatus)) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (role === "admin" && nextStatus && !canAdminPatchProductStatus(existingStatus, nextStatus)) {
    return res.status(400).json({
      error: "invalid_status_transition",
      message:
        "Invalid status transition. Pending requests must be approved or rejected from the onboarding queue.",
    });
  }
  if (nextStatus) {
    patch.is_active = nextStatus === PRODUCT_STATUS_ACTIVE;
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
    return res.status(403).json({ error: "forbidden" });
  }

  const hasProductFields = Object.keys(patch).length > 0;
  const hasVariantUpdates = variantPayloads.length > 0;
  if (!hasProductFields && !hasVariantUpdates) {
    return res.status(400).json({ error: "no_fields" });
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
    const updatedRows = await db("products")
      .where({ id })
      .update(patch)
      .returning(productReturningFields);
    if (!updatedRows || updatedRows.length === 0) {
      return res.status(404).json(NOT_FOUND);
    }
  }

  const productRow = await db("products")
    .select(productReturningFields)
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

      const variantSelection = ["id"];
      if (hasVariantColumn("price_cents")) variantSelection.push("price_cents");
      if (hasVariantColumn("selling_price_cents")) variantSelection.push("selling_price_cents");
      if (hasVariantColumn("vendor_payout_cents")) variantSelection.push("vendor_payout_cents");
      if (hasVariantColumn("royalty_cents")) variantSelection.push("royalty_cents");
      if (hasVariantColumn("our_share_cents")) variantSelection.push("our_share_cents");
      const variantRow = await db("product_variants")
        .select(variantSelection)
        .where({ id: variantId, product_id: id })
        .first();
      if (!variantRow) {
        return res.status(404).json({ error: "variant_not_found" });
      }

      const variantPatch = {};

      if (
        typeof variantUpdate.price !== "undefined" ||
        typeof variantUpdate.priceCents !== "undefined" ||
        typeof variantUpdate.price_cents !== "undefined" ||
        typeof variantUpdate.sellingPriceCents !== "undefined" ||
        typeof variantUpdate.selling_price_cents !== "undefined"
      ) {
        const priceResult = normalizeProductPrice({
          price: variantUpdate.price,
          priceCents:
            variantUpdate.sellingPriceCents ??
            variantUpdate.selling_price_cents ??
            variantUpdate.priceCents ??
            variantUpdate.price_cents,
          requirePrice: false,
        });
        if (priceResult.error) {
          return res.status(400).json({ error: priceResult.error });
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
          return res.status(400).json({ error: "invalid_is_listed" });
        }
        if (hasVariantColumn("is_listed")) {
          variantPatch.is_listed = isListedRaw;
        }
      }

      const nextInventorySkuId = asUuidOrNull(
        variantUpdate.inventorySkuId ?? variantUpdate.inventory_sku_id
      );
      if (
        typeof variantUpdate.inventorySkuId !== "undefined" ||
        typeof variantUpdate.inventory_sku_id !== "undefined"
      ) {
        if (!hasVariantColumn("inventory_sku_id")) {
          return res.status(500).json({ error: "inventory_sku_not_configured" });
        }
        if (!nextInventorySkuId) {
          return res.status(400).json({ error: "invalid_inventory_sku_id" });
        }
        const existingSku = await db("inventory_skus")
          .select("id")
          .where({ id: nextInventorySkuId })
          .first();
        if (!existingSku) {
          return res.status(400).json({ error: "inventory_sku_not_found" });
        }
        const duplicateMapping = await db("product_variants")
          .select("id")
          .where({ product_id: id, inventory_sku_id: nextInventorySkuId })
          .whereNot({ id: variantId })
          .first();
        if (duplicateMapping) {
          return res.status(409).json({ error: "duplicate_inventory_sku_mapping" });
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
        const parsed = parseNonNegativeInt(variantUpdate[snake] ?? variantUpdate[camel]);
        if (parsed === null) {
          return res.status(400).json({ error: `invalid_${snake}` });
        }
        variantPatch[snake] = parsed;
      }

      if (hasVariantColumn("our_share_cents")) {
        const hasExplicitOurShare =
          typeof variantUpdate.our_share_cents !== "undefined" ||
          typeof variantUpdate.ourShareCents !== "undefined";
        const nextSellingPrice = parseNonNegativeInt(
          variantPatch.selling_price_cents ??
            variantRow.selling_price_cents ??
            variantPatch.price_cents ??
            variantRow.price_cents
        );
        const nextVendorPayout = parseNonNegativeInt(
          variantPatch.vendor_payout_cents ?? variantRow.vendor_payout_cents
        );
        const nextRoyalty = parseNonNegativeInt(
          variantPatch.royalty_cents ?? variantRow.royalty_cents
        );
        const nextOurShareInput = hasExplicitOurShare
          ? variantPatch.our_share_cents
          : parseNonNegativeInt(variantRow.our_share_cents);

        const shareResolution = resolveOurShareCents({
          sellingPriceCents: nextSellingPrice,
          vendorPayoutCents:
            nextVendorPayout === null ? undefined : nextVendorPayout,
          royaltyCents: nextRoyalty === null ? undefined : nextRoyalty,
          ourShareCents: nextOurShareInput === null ? undefined : nextOurShareInput,
        });
        if (shareResolution.error) {
          return res.status(400).json({ error: shareResolution.error });
        }
        if (
          !hasExplicitOurShare &&
          nextVendorPayout !== null &&
          nextRoyalty !== null &&
          typeof shareResolution.ourShareCents !== "number"
        ) {
          return res.status(400).json({ error: "invalid_our_share_cents" });
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
      await db("product_variants").where({ id: variantId }).update(variantPatch);
    }
  }

  const primaryVariantRaw = await buildVariantInventoryQuery(db, { productId: id })
    .orderBy("pv.created_at", "asc")
    .first();
  const primaryVariant = formatVariantInventoryRow(primaryVariantRaw);

  return res.json({
    product: withStatus({
      id: productRow.id,
      title: productRow.title,
      description: productRow.description,
      isActive: Boolean(productRow.isActive),
      status: productRow.status,
      rejectionReason: productRow.rejectionReason ?? null,
      rejection_reason: productRow.rejectionReason ?? null,
      skuTypes: Array.isArray(productRow.skuTypes) ? productRow.skuTypes : [],
      sku_types: Array.isArray(productRow.skuTypes) ? productRow.skuTypes : [],
    }),
    defaultVariant: primaryVariant || null,
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
  createArtistOnboardingRequest,
  listAdminOnboardingRequests,
  approveOnboardingRequest,
  rejectOnboardingRequest,
  createProduct,
  updateProduct,
  updateProductPhotos,
  __test: {
    normalizeProductStatusValue,
    normalizeProductStatusFromRecord,
    canArtistToggleProductStatus,
    canAdminPatchProductStatus,
    parseOnboardingSkuTypes,
  },
};
