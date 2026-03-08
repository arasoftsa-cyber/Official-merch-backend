const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { getUploadDir, ensureUploadDir } = require("../core/config/uploadPaths");
const { toAbsolutePublicUrl } = require("../utils/publicUrl");
const {
  buildSellableMinPriceSubquery,
  applySellableVariantExists,
  buildVariantInventoryQuery,
  formatVariantInventoryRow,
} = require("../services/variantAvailability.service");
const {
  resolveOurShareCents,
  isNonNegativeInteger,
} = require("../utils/economics");

const PRODUCT_UPLOAD_DIR = getUploadDir("products");
const ALLOWED_PRODUCT_COLORS = new Set([
  "black",
  "white",
  "yellow",
  "maroon",
  "navy_blue",
]);
const LISTING_PHOTO_FIELD_NAMES = [
  "listing_photo_1",
  "listing_photo_2",
  "listing_photo_3",
  "listing_photo_4",
];
const LISTING_PHOTO_COLLECTION_FIELDS = ["listing_photos", "photos"];
const NEW_MERCH_TRIGGER_FIELDS = new Set([
  "merch_name",
  "merchName",
  "merch_story",
  "merchStory",
  "merch_mrp",
  "merchMrp",
  "mrp_cents",
  "mrpCents",
  "selling_price_cents",
  "sellingPriceCents",
  "vendor_pay",
  "vendorPay",
  "vendor_pay_cents",
  "vendorPayCents",
  "vendor_payout_cents",
  "vendorPayoutCents",
  "our_share",
  "ourShare",
  "our_share_cents",
  "ourShareCents",
  "royalty",
  "royalty_cents",
  "royaltyCents",
  "merch_type",
  "merchType",
  "colors",
]);
const ONBOARDING_ALLOWED_SKU_TYPES = new Set([
  "regular_tshirt",
  "oversized_tshirt",
  "hoodie",
  "oversized_hoodie",
]);
const DESIGN_IMAGE_FIELD_NAMES = ["design_image", "designImage", "design"];
const ALLOWED_DESIGN_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/svg+xml",
]);
const ALLOWED_DESIGN_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg"];

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

const parseMerchMoneyToCents = ({
  body = {},
  centsKeys = [],
  amountKeys = [],
  minCents = 0,
  required = false,
} = {}) => {
  const centsValue = firstPresent(body, centsKeys);
  if (centsValue !== undefined) {
    const parsed = parseNonNegativeInt(centsValue);
    if (parsed === null || parsed < minCents) return { ok: false, value: null, provided: true };
    return { ok: true, value: parsed, provided: true };
  }

  const amountValue = firstPresent(body, amountKeys);
  if (amountValue !== undefined) {
    const numeric = Number(amountValue);
    if (!Number.isFinite(numeric)) return { ok: false, value: null, provided: true };
    const cents = Math.round(numeric * 100);
    if (!Number.isInteger(cents) || cents < minCents) return { ok: false, value: null, provided: true };
    return { ok: true, value: cents, provided: true };
  }

  if (required) return { ok: false, value: null, provided: false };
  return { ok: true, value: null, provided: false };
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

const validateProductColors = (rawColors, { required = false, defaultToBlack = false } = {}) => {
  let colors = normalizeColors(rawColors);
  if (!colors.length && defaultToBlack) colors = ["black"];

  const details = [];
  if (required && colors.length < 1) {
    details.push({ field: "colors", message: "colors must include at least one value" });
  }

  const invalid = colors.filter((color) => !ALLOWED_PRODUCT_COLORS.has(color));
  if (invalid.length > 0) {
    details.push({
      field: "colors",
      message: `unsupported color(s): ${invalid.join(", ")}`,
    });
  }

  return {
    ok: details.length === 0,
    colors,
    details,
  };
};

const validateListingPhotoFiles = (
  filesByField = {},
  { required = true, minFiles: minFilesInput, maxFiles: maxFilesInput, maxIndexedField: maxIndexedFieldInput } = {}
) => {
  const minFiles = Number.isInteger(minFilesInput)
    ? Math.max(0, minFilesInput)
    : required
    ? 4
    : 0;
  const maxFiles = Number.isInteger(maxFilesInput)
    ? Math.max(1, maxFilesInput)
    : 4;
  const maxIndexedField = Number.isInteger(maxIndexedFieldInput)
    ? Math.max(1, maxIndexedFieldInput)
    : maxFiles;
  const indexedListingFieldRe = /^listing_photo_(\d+)$/i;
  const asFileArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.filter((entry) => entry?.buffer?.length);
    }
    return value?.buffer?.length ? [value] : [];
  };

  const details = [];
  const collectionFiles = LISTING_PHOTO_COLLECTION_FIELDS.flatMap((field) =>
    asFileArray(filesByField[field])
  );

  let listingFiles = [];
  if (collectionFiles.length > 0) {
    listingFiles = collectionFiles;
  } else {
    const indexedFields = Object.keys(filesByField || {})
      .map((field) => {
        const match = field.match(indexedListingFieldRe);
        if (!match) return null;
        const index = Number(match[1]);
        if (!Number.isInteger(index) || index < 1 || index > maxIndexedField) return null;
        return { field, index };
      })
      .filter(Boolean)
      .sort((a, b) => a.index - b.index);

    if (indexedFields.length > 0) {
      listingFiles = indexedFields
        .map(({ field }) => asFileArray(filesByField[field])[0])
        .filter(Boolean);
    } else {
      listingFiles = LISTING_PHOTO_FIELD_NAMES.map((field) => {
        const files = asFileArray(filesByField[field]);
        return files[0];
      }).filter(Boolean);
    }
  }

  if (required && collectionFiles.length === 0) {
    const requiredFieldCount = minFiles > 0 ? minFiles : 1;
    for (let index = 1; index <= requiredFieldCount; index += 1) {
      const field = `listing_photo_${index}`;
      if (asFileArray(filesByField[field]).length === 0 && !Object.keys(filesByField).some((key) => {
        const match = key.match(indexedListingFieldRe);
        return Boolean(match && Number(match[1]) === index && asFileArray(filesByField[key]).length > 0);
      })) {
        details.push({ field, message: `${field} file is required` });
      }
    }
  }

  const providedListingFileKeys = Object.keys(filesByField).filter((field) => {
    if (indexedListingFieldRe.test(field)) return true;
    return LISTING_PHOTO_COLLECTION_FIELDS.includes(field);
  });
  const hasUnexpectedListingFields = providedListingFileKeys.some((field) => {
    if (LISTING_PHOTO_COLLECTION_FIELDS.includes(field)) return false;
    const match = field.match(indexedListingFieldRe);
    if (!match) return true;
    const idx = Number(match[1]);
    return !Number.isInteger(idx) || idx < 1 || idx > maxIndexedField;
  });

  const unexpectedPhotoType = providedListingFileKeys.some((field) =>
    asFileArray(filesByField[field]).some((entry) => {
      const mimeType = String(entry?.mimetype || "").toLowerCase();
      return mimeType && !mimeType.startsWith("image/");
    })
  );

  if (required && minFiles === maxFiles) {
    if (listingFiles.length !== minFiles) {
      details.push({ field: "photos", message: `exactly ${minFiles} photos are required` });
    }
  } else {
    if (required && listingFiles.length < minFiles) {
      details.push({
        field: "photos",
        message: `at least ${minFiles} photos are required`,
      });
    }
    if (listingFiles.length > maxFiles) {
      details.push({
        field: "photos",
        message: `at most ${maxFiles} photos are allowed`,
      });
    }
  }

  if (hasUnexpectedListingFields || unexpectedPhotoType) {
    details.push({ field: "photos", message: "invalid photos payload" });
  }

  return {
    ok: details.length === 0,
    details,
    listingFiles,
  };
};

const validateDesignImageFile = (filesByField = {}, { required = true } = {}) => {
  const asFileArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.filter((entry) => entry?.buffer?.length);
    }
    return value?.buffer?.length ? [value] : [];
  };

  const details = [];
  const files = DESIGN_IMAGE_FIELD_NAMES.flatMap((field) => asFileArray(filesByField[field]));
  const designFile = files[0] || null;

  if (required && !designFile) {
    details.push({ field: "design_image", message: "design image is required" });
  }
  if (files.length > 1) {
    details.push({ field: "design_image", message: "only one design image is allowed" });
  }
  if (designFile) {
    const mimeType = String(designFile.mimetype || "").toLowerCase();
    const originalName = String(designFile.originalname || "").toLowerCase();
    const extensionAllowed = ALLOWED_DESIGN_IMAGE_EXTENSIONS.some((ext) =>
      originalName.endsWith(ext)
    );
    const mimeAllowed =
      !mimeType || ALLOWED_DESIGN_IMAGE_MIME_TYPES.has(mimeType);
    if (!mimeAllowed && !extensionAllowed) {
      details.push({
        field: "design_image",
        message: "design image must be PNG, JPG, JPEG, or SVG",
      });
    }
  }

  return {
    ok: details.length === 0,
    details,
    designFile,
  };
};

const normalizeSkuTypes = (rawValue) => {
  if (rawValue === undefined || rawValue === null) {
    return { skuTypes: [], invalid: [] };
  }

  let list = rawValue;
  if (typeof list === "string") {
    const trimmed = list.trim();
    if (!trimmed) {
      list = [];
    } else {
      try {
        const parsed = JSON.parse(trimmed);
        list = Array.isArray(parsed) ? parsed : [trimmed];
      } catch (_err) {
        list = trimmed
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
    }
  }
  if (!Array.isArray(list)) {
    list = [list];
  }

  const normalized = [];
  const invalid = [];
  for (const item of list) {
    const value = readText(item).toLowerCase();
    if (!value) continue;
    if (!ONBOARDING_ALLOWED_SKU_TYPES.has(value)) {
      invalid.push(value);
      continue;
    }
    if (!normalized.includes(value)) normalized.push(value);
  }

  return { skuTypes: normalized, invalid };
};

const getActiveProducts = async () => {
  const db = getDb();
  const productColumns = await db("products").columnInfo();
  const hasStatus = Object.prototype.hasOwnProperty.call(productColumns, "status");
  const hasIsActive = Object.prototype.hasOwnProperty.call(productColumns, "is_active");
  const query = db("products")
    .select(
      "id",
      "title",
      "description",
      "created_at",
      "artist_id as artistId",
      "is_active",
      "is_active as isActive",
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"priceCents\""),
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\"")
    );
  if (hasStatus) {
    query.where({ status: "active" });
  } else if (hasIsActive) {
    query.where({ is_active: true });
  } else {
    query.whereRaw("1 = 0");
  }
  applySellableVariantExists(query);
  return query;
};

const getAdminProducts = async () => {
  const db = getDb();
  const columns = await db("products").columnInfo();
  const selections = [
    "id",
    "title",
    "description",
    "created_at",
    "artist_id as artistId",
    "is_active",
    "is_active as isActive",
  ];
  const hasStatus = Object.prototype.hasOwnProperty.call(columns, "status");

  if (Object.prototype.hasOwnProperty.call(columns, "merch_story")) {
    selections.push("merch_story");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "mrp_cents")) {
    selections.push("mrp_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "vendor_payout_cents")) {
    selections.push("vendor_payout_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "selling_price_cents")) {
    selections.push("selling_price_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "our_share_cents")) {
    selections.push("our_share_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "royalty_cents")) {
    selections.push("royalty_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "merch_type")) {
    selections.push("merch_type");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "colors")) {
    selections.push("colors");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "listing_photos")) {
    selections.push("listing_photos");
  }
  if (hasStatus) {
    selections.push("status");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "rejection_reason")) {
    selections.push("rejection_reason");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "sku_types")) {
    selections.push("sku_types");
  }

  const query = db("products")
    .select(
      selections.concat([
        buildSellableMinPriceSubquery(db).wrap("(", ") as \"priceCents\""),
        buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\""),
      ])
    );

  if (hasStatus) {
    query.where((builder) => {
      builder
        .whereIn("status", ["active", "inactive"])
        .orWhere((fallback) => fallback.whereNull("status").andWhere("is_active", true));
    });
  }

  return query.orderBy("created_at", "desc");
};

const getProductsByArtistId = async (artistId) => {
  const db = getDb();
  const columns = await db("products").columnInfo();
  const selections = [
    "id",
    "title",
    "description",
    "created_at",
    "updated_at",
    "artist_id as artistId",
    "is_active",
    "is_active as isActive",
  ];
  if (Object.prototype.hasOwnProperty.call(columns, "status")) {
    selections.push("status");
  }
  return db("products")
    .select(
      ...selections,
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\"")
    )
    .where({ artist_id: artistId })
    .orderBy("created_at", "desc");
};

const getProductById = async (id) => {
  const db = getDb();
  const product = await db("products")
    .select(
      "products.*",
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"priceCents\""),
      buildSellableMinPriceSubquery(db).wrap("(", ") as \"minVariantPriceCents\"")
    )
    .where({ id })
    .first();
  if (!product) {
    return null;
  }
  const variants = (
    await buildVariantInventoryQuery(db, { productId: id }).orderBy("pv.created_at", "asc")
  ).map(formatVariantInventoryRow);
  return {
    product,
    variants,
  };
};

const detectNewMerchFlow = (body = {}, filesByField = {}) => {
  if (!body || typeof body !== "object") return false;
  const hasBodyTrigger = Object.keys(body).some((key) => {
    if (!NEW_MERCH_TRIGGER_FIELDS.has(key)) return false;
    const val = body[key];
    if (val === undefined || val === null) return false;
    if (typeof val === "string" && val.trim() === "") return false;
    return true;
  });
  if (hasBodyTrigger) return true;

  return Object.keys(filesByField || {}).some((field) => /^listing_photo_\d+$/i.test(field));
};

const validateNewMerch = (body = {}, filesByField = {}, options = {}) => {
  const requireListingPhotos = Boolean(options?.requireListingPhotos);
  const details = [];
  const add = (field, message) => details.push({ field, message });

  const artistId = readText(body.artist_id || body.artistId);
  const merchName = readText(body.merch_name || body.merchName || body.title);
  const merchStory = readText(body.merch_story || body.merchStory);
  const mrpCentsParsed = parseMerchMoneyToCents({
    body,
    centsKeys: ["mrp_cents", "mrpCents"],
    amountKeys: ["merch_mrp", "merchMrp"],
    minCents: 1,
    required: false,
  });
  const vendorPayoutCentsParsed = parseMerchMoneyToCents({
    body,
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
  const sellingPriceCentsParsed = parseMerchMoneyToCents({
    body,
    centsKeys: [
      "selling_price_cents",
      "sellingPriceCents",
      "price_cents",
      "priceCents",
    ],
    amountKeys: ["selling_price", "sellingPrice", "price"],
    minCents: 1,
    required: false,
  });
  const ourShareCentsParsed = parseMerchMoneyToCents({
    body,
    centsKeys: ["our_share_cents", "ourShareCents"],
    amountKeys: ["our_share", "ourShare"],
    minCents: 0,
    required: false,
  });
  const royaltyCentsParsed = parseMerchMoneyToCents({
    body,
    centsKeys: ["royalty_cents", "royaltyCents"],
    amountKeys: ["royalty"],
    minCents: 0,
    required: true,
  });
  const merchType = readText(body.merch_type || body.merchType);
  const colorsResult = validateProductColors(body.colors, {
    required: true,
    defaultToBlack: true,
  });

  if (!artistId) add("artist_id", "artist_id is required");
  if (!merchName || merchName.length < 2) {
    add("merch_name", "merch_name must be at least 2 characters");
  }
  if (!merchStory || merchStory.length < 10) {
    add("merch_story", "merch_story must be at least 10 characters");
  }
  if (!mrpCentsParsed.ok && mrpCentsParsed.provided) {
    add("mrp_cents", "mrp_cents/merch_mrp must be a number greater than 0");
  }
  if (!sellingPriceCentsParsed.ok && sellingPriceCentsParsed.provided) {
    add(
      "selling_price_cents",
      "selling_price_cents/price must be a number greater than 0"
    );
  }
  if (!vendorPayoutCentsParsed.ok) {
    add(
      "vendor_payout_cents",
      "vendor_payout_cents/vendor_pay must be a number >= 0"
    );
  }
  if (!ourShareCentsParsed.ok) {
    add("our_share_cents", "our_share_cents/our_share must be a number >= 0");
  }
  if (!royaltyCentsParsed.ok) {
    add("royalty_cents", "royalty_cents/royalty must be a number >= 0");
  }
  if (!merchType) add("merch_type", "merch_type is required");
  if (!colorsResult.ok) details.push(...colorsResult.details);

  const listingValidation = validateListingPhotoFiles(filesByField, {
    required: requireListingPhotos,
  });
  if (!listingValidation.ok) details.push(...listingValidation.details);

  const derivedSellingPriceCents = deriveSellingPriceFromSplit({
    vendorPayoutCents: vendorPayoutCentsParsed.value,
    royaltyCents: royaltyCentsParsed.value,
    ourShareCents: ourShareCentsParsed.value,
  });
  const sellingPriceCents =
    sellingPriceCentsParsed.value ?? mrpCentsParsed.value ?? derivedSellingPriceCents ?? null;

  const shareResolution = resolveOurShareCents({
    sellingPriceCents,
    vendorPayoutCents: vendorPayoutCentsParsed.value,
    royaltyCents: royaltyCentsParsed.value,
    ourShareCents: ourShareCentsParsed.provided ? ourShareCentsParsed.value : undefined,
  });
  if (shareResolution.error) {
    add("our_share_cents", "our_share_cents must be a non-negative integer");
  } else if (
    !ourShareCentsParsed.provided &&
    isNonNegativeInteger(sellingPriceCents) &&
    typeof vendorPayoutCentsParsed.value === "number" &&
    typeof royaltyCentsParsed.value === "number" &&
    typeof shareResolution.ourShareCents !== "number"
  ) {
    add(
      "our_share_cents",
      "our_share_cents would be negative with current selling/vendor/royalty values"
    );
  }

  if (details.length > 0) return { ok: false, details };

  return {
    ok: true,
    value: {
      artistId,
      merchName,
      merchStory,
      mrpCents: mrpCentsParsed.value,
      sellingPriceCents,
      vendorPayoutCents: vendorPayoutCentsParsed.value,
      ourShareCents:
        typeof shareResolution.ourShareCents === "number"
          ? shareResolution.ourShareCents
          : null,
      royaltyCents: royaltyCentsParsed.value,
      merchType,
      colors: colorsResult.colors,
      listingFiles: listingValidation.listingFiles,
      description: readText(body.description),
    },
  };
};

const saveProductListingPhotos = async ({ trx, productId, files = [] }) => {
  return saveProductMediaFiles({ trx, productId, files, role: "listing_photo" });
};

const saveProductMediaFiles = async ({ trx, productId, files = [], role = "listing_photo" }) => {
  ensureUploadDir("products");
  const urls = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const extRaw = path.extname(file.originalname || "").slice(0, 12);
    const ext = /^[.][a-z0-9]+$/i.test(extRaw) ? extRaw.toLowerCase() : "";
    const filename = `${Date.now()}-${randomUUID()}${ext}`;
    const absolutePath = path.join(PRODUCT_UPLOAD_DIR, filename);
    await fs.promises.writeFile(absolutePath, file.buffer);

    const publicUrl = `/uploads/products/${filename}`;
    const mediaAssetId = randomUUID();
    await trx("media_assets").insert({
      id: mediaAssetId,
      public_url: publicUrl,
      created_at: trx.fn.now(),
    });

    await trx("entity_media_links").insert({
      id: randomUUID(),
      media_asset_id: mediaAssetId,
      entity_type: "product",
      entity_id: productId,
      role,
      sort_order: index,
      created_at: trx.fn.now(),
    });

    urls.push(publicUrl);
  }

  return urls;
};

const loadProductListingPhotos = async (productId) => {
  return loadProductMediaByRole({ productId, role: "listing_photo" });
};

const loadProductMediaByRole = async ({ productId, role }) => {
  if (!productId) return [];
  const db = getDb();
  const hasEntityMediaLinks = await db.schema.hasTable("entity_media_links");
  const hasMediaAssets = await db.schema.hasTable("media_assets");
  if (!hasEntityMediaLinks || !hasMediaAssets) return [];

  const rows = await db("entity_media_links as eml")
    .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
    .where("eml.entity_type", "product")
    .andWhere("eml.entity_id", productId)
    .andWhere("eml.role", role)
    .orderBy("eml.sort_order", "asc")
    .select("ma.public_url");

  return rows
    .map((row) => toAbsolutePublicUrl(row.public_url))
    .filter(Boolean);
};

const loadProductDesignImage = async (productId) => {
  const urls = await loadProductMediaByRole({ productId, role: "design_image" });
  return urls[0] || "";
};

const attachListingPhotosToProducts = async (products = []) => {
  if (!Array.isArray(products) || products.length === 0) return products;

  const db = getDb();
  const hasEntityMediaLinks = await db.schema.hasTable("entity_media_links");
  const hasMediaAssets = await db.schema.hasTable("media_assets");
  if (!hasEntityMediaLinks || !hasMediaAssets) {
    return products.map((product) => ({
      ...product,
      listingPhotoUrls: [],
      listing_photos: [],
      photos: [],
      primaryPhotoUrl: "",
      cover_photo_url: null,
    }));
  }

  const productIds = products.map((p) => p.id).filter(Boolean);
  if (!productIds.length) {
    return products.map((product) => ({
      ...product,
      listingPhotoUrls: [],
      listing_photos: [],
      photos: [],
      primaryPhotoUrl: "",
      cover_photo_url: null,
    }));
  }

  const rows = await db("entity_media_links as eml")
    .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
    .where("eml.entity_type", "product")
    .whereIn("eml.entity_id", productIds)
    .andWhere("eml.role", "listing_photo")
    .orderBy("eml.entity_id", "asc")
    .orderBy("eml.sort_order", "asc")
    .select("eml.entity_id", "ma.public_url");

  const byProductId = new Map();
  for (const row of rows) {
    const key = row.entity_id;
    if (!byProductId.has(key)) byProductId.set(key, []);
    const url = toAbsolutePublicUrl(row.public_url);
    if (url) byProductId.get(key).push(url);
  }

  return products.map((product) => ({
    ...product,
    listingPhotoUrls: byProductId.get(product.id) || [],
    listing_photos: byProductId.get(product.id) || [],
    photoUrls: byProductId.get(product.id) || [],
    photos: byProductId.get(product.id) || [],
    listingPhotoUrl: (byProductId.get(product.id) || [])[0] || "",
    primaryPhotoUrl: (byProductId.get(product.id) || [])[0] || "",
    cover_photo_url: (byProductId.get(product.id) || [])[0] || null,
  }));
};

const replaceProductListingPhotos = async ({ trx, productId, files = [] }) => {
  return replaceProductMediaByRole({
    trx,
    productId,
    files,
    role: "listing_photo",
  });
};

const replaceProductMediaByRole = async ({ trx, productId, files = [], role }) => {
  await trx("entity_media_links")
    .where({
      entity_type: "product",
      entity_id: productId,
      role,
    })
    .delete();

  return saveProductMediaFiles({
    trx,
    productId,
    files,
    role,
  });
};

const saveProductDesignImage = async ({ trx, productId, file }) => {
  if (!file) return "";
  const urls = await replaceProductMediaByRole({
    trx,
    productId,
    files: [file],
    role: "design_image",
  });
  return urls[0] || "";
};

const createProductWithVariants = async (input) => {
  const db = getDb();
  return db.transaction(async (trx) => {
    const productId = randomUUID();
    const [productColumns, variantColumns, skuColumns] = await Promise.all([
      trx("products").columnInfo(),
      trx("product_variants").columnInfo(),
      trx("inventory_skus").columnInfo(),
    ]);

    const hasProductColumn = (name) => Object.prototype.hasOwnProperty.call(productColumns, name);
    const hasVariantColumn = (name) => Object.prototype.hasOwnProperty.call(variantColumns, name);
    const hasSkuColumn = (name) => Object.prototype.hasOwnProperty.call(skuColumns, name);
    const normalizedRequestedStatus = ["pending", "inactive", "active", "rejected"].includes(
      String(input?.status || "")
        .trim()
        .toLowerCase()
    )
      ? String(input.status).trim().toLowerCase()
      : null;
    const resolvedStatus =
      normalizedRequestedStatus ||
      ((input.isActive === undefined ? true : Boolean(input.isActive)) ? "active" : "inactive");

    const productInsert = {
      id: productId,
      artist_id: input.artistId,
      title: input.title,
      description: input.description || null,
      is_active: resolvedStatus === "active",
    };
    if (hasProductColumn("status")) {
      productInsert.status = resolvedStatus;
    }
    if (hasProductColumn("rejection_reason") && resolvedStatus !== "rejected") {
      productInsert.rejection_reason = null;
    }

    await trx("products").insert(productInsert);

    const variantRows = [];
    const seenSupplierSkus = new Set();
    for (let index = 0; index < input.variants.length; index += 1) {
      const variant = input.variants[index] || {};
      const stock = parseNonNegativeInt(variant.stock) ?? 0;
      const size = String(variant.size || "default").trim() || "default";
      const color = String(variant.color || "default").trim() || "default";
      const merchType = String(variant.merchType || variant.merch_type || "default").trim() || "default";
      const inventorySkuIdInput = String(
        variant.inventorySkuId || variant.inventory_sku_id || ""
      ).trim();

      let inventorySkuId = inventorySkuIdInput || null;
      if (inventorySkuId) {
        const existingSku = await trx("inventory_skus").where({ id: inventorySkuId }).first("id");
        if (!existingSku) {
          throw Object.assign(new Error("inventory_sku_not_found"), { code: "INVENTORY_SKU_NOT_FOUND" });
        }
      } else {
        let supplierSku = String(variant.supplierSku || variant.supplier_sku || "").trim();
        if (!supplierSku) {
          supplierSku = buildTransitionalSupplierSku({ productId, variant, index });
        }
        if (seenSupplierSkus.has(supplierSku)) {
          supplierSku = `${supplierSku}-${String(randomUUID()).slice(0, 8).toUpperCase()}`;
        }
        seenSupplierSkus.add(supplierSku);

        const skuInsert = {
          id: randomUUID(),
          supplier_sku: supplierSku,
          merch_type: merchType,
          quality_tier: variant.qualityTier || variant.quality_tier || null,
          size,
          color,
          stock,
          is_active: true,
          metadata: trx.raw("?::jsonb", [JSON.stringify({ source: "createProductWithVariants" })]),
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        };

        if (hasSkuColumn("supplier_cost_cents")) {
          skuInsert.supplier_cost_cents = parseNonNegativeInt(
            variant.supplierCostCents ?? variant.supplier_cost_cents
          );
        }
        if (hasSkuColumn("mrp_cents")) {
          skuInsert.mrp_cents = parseNonNegativeInt(variant.mrpCents ?? variant.mrp_cents);
        }

        const [createdSku] = await trx("inventory_skus")
          .insert(skuInsert)
          .returning("id");
        inventorySkuId = createdSku?.id || skuInsert.id;
      }

      const priceCents = parseNonNegativeInt(variant.priceCents ?? variant.price_cents);
      if (priceCents === null) {
        throw Object.assign(new Error("invalid_price"), { code: "INVALID_VARIANT_PRICE" });
      }
      const vendorPayoutCents = parseNonNegativeInt(
        variant.vendorPayoutCents ?? variant.vendor_payout_cents
      );
      const royaltyCents = parseNonNegativeInt(
        variant.royaltyCents ?? variant.royalty_cents
      );
      const ourShareParsed = parseNonNegativeInt(
        variant.ourShareCents ?? variant.our_share_cents
      );
      const shareResolution = resolveOurShareCents({
        sellingPriceCents: priceCents,
        vendorPayoutCents:
          vendorPayoutCents === null ? undefined : vendorPayoutCents,
        royaltyCents: royaltyCents === null ? undefined : royaltyCents,
        ourShareCents: ourShareParsed === null ? undefined : ourShareParsed,
      });
      if (shareResolution.error) {
        throw Object.assign(new Error(shareResolution.error), {
          code: "INVALID_VARIANT_ECONOMICS",
        });
      }
      if (
        ourShareParsed === null &&
        vendorPayoutCents !== null &&
        royaltyCents !== null &&
        typeof shareResolution.ourShareCents !== "number"
      ) {
        throw Object.assign(new Error("invalid_our_share_cents"), {
          code: "INVALID_VARIANT_ECONOMICS",
        });
      }

      const variantInsert = {
        id: randomUUID(),
        product_id: productId,
        sku: String(variant.sku || `SKU-${String(productId).slice(0, 8)}-${index + 1}`).trim(),
        size,
        color,
        price_cents: priceCents,
        created_at: trx.fn.now(),
      };
      if (hasVariantColumn("inventory_sku_id")) {
        variantInsert.inventory_sku_id = inventorySkuId;
      }
      if (hasVariantColumn("is_listed")) {
        variantInsert.is_listed = variant.isListed !== false;
      }
      if (hasVariantColumn("selling_price_cents")) {
        variantInsert.selling_price_cents = priceCents;
      }
      if (hasVariantColumn("vendor_payout_cents") && vendorPayoutCents !== null) {
        variantInsert.vendor_payout_cents = vendorPayoutCents;
      }
      if (hasVariantColumn("royalty_cents") && royaltyCents !== null) {
        variantInsert.royalty_cents = royaltyCents;
      }
      if (
        hasVariantColumn("our_share_cents") &&
        typeof shareResolution.ourShareCents === "number"
      ) {
        variantInsert.our_share_cents = shareResolution.ourShareCents;
      }
      if (hasVariantColumn("stock")) {
        // Compatibility mirror only; source of truth is inventory_skus.stock.
        variantInsert.stock = stock;
      }
      if (hasVariantColumn("updated_at")) {
        variantInsert.updated_at = trx.fn.now();
      }
      variantRows.push(variantInsert);
    }

    await trx("product_variants").insert(variantRows);

    return productId;
  });
};

module.exports = {
  getActiveProducts,
  getAdminProducts,
  getProductsByArtistId,
  getProductById,
  detectNewMerchFlow,
  validateNewMerch,
  validateListingPhotoFiles,
  validateDesignImageFile,
  normalizeSkuTypes,
  validateProductColors,
  parseMerchMoneyToCents,
  ONBOARDING_ALLOWED_SKU_TYPES,
  saveProductListingPhotos,
  replaceProductListingPhotos,
  loadProductListingPhotos,
  saveProductDesignImage,
  loadProductDesignImage,
  attachListingPhotosToProducts,
  createProductWithVariants,
};

