const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");
const { UPLOADS_DIR } = require("../../config/paths");
const { toAbsolutePublicUrl } = require("../../utils/publicUrl");

const PRODUCT_UPLOAD_DIR = path.join(UPLOADS_DIR, "products");
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

const validateListingPhotoFiles = (filesByField = {}, { required = true } = {}) => {
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
    listingFiles = LISTING_PHOTO_FIELD_NAMES.map((field) => {
      const files = asFileArray(filesByField[field]);
      return files[0];
    }).filter(Boolean);
  }

  if (required && collectionFiles.length === 0) {
    for (const field of LISTING_PHOTO_FIELD_NAMES) {
      if (asFileArray(filesByField[field]).length === 0) {
        details.push({ field, message: `${field} file is required` });
      }
    }
  }

  const providedListingFileKeys = Object.keys(filesByField).filter((field) => {
    if (/^listing_photo_\d+$/i.test(field)) return true;
    return LISTING_PHOTO_COLLECTION_FIELDS.includes(field);
  });
  const hasUnexpectedListingFields = providedListingFileKeys.some((field) => {
    if (LISTING_PHOTO_COLLECTION_FIELDS.includes(field)) return false;
    return !LISTING_PHOTO_FIELD_NAMES.includes(field);
  });

  const unexpectedPhotoType = providedListingFileKeys.some((field) =>
    asFileArray(filesByField[field]).some((entry) => {
      const mimeType = String(entry?.mimetype || "").toLowerCase();
      return mimeType && !mimeType.startsWith("image/");
    })
  );

  if (listingFiles.length > 4) {
    details.push({ field: "photos", message: "maximum 4 photos allowed" });
  }

  if (required && listingFiles.length !== 4) {
    details.push({ field: "photos", message: "exactly 4 photos are required" });
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

const getActiveProducts = async () => {
  const db = getDb();
  return db("products")
    .select(
      "id",
      "title",
      "description",
      "created_at",
      "artist_id as artistId",
      "is_active",
      "is_active as isActive",
      db.raw(
        "(select min(price_cents) from product_variants v where v.product_id = products.id) as priceCents"
      ),
      db.raw(
        "(select min(price_cents) from product_variants v where v.product_id = products.id) as minVariantPriceCents"
      )
    )
    .where({ is_active: true });
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
  if (Object.prototype.hasOwnProperty.call(columns, "merch_story")) {
    selections.push("merch_story");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "mrp_cents")) {
    selections.push("mrp_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "vendor_pay_cents")) {
    selections.push("vendor_pay_cents");
  }
  if (Object.prototype.hasOwnProperty.call(columns, "vendor_payout_cents")) {
    selections.push("vendor_payout_cents");
    if (!Object.prototype.hasOwnProperty.call(columns, "vendor_pay_cents")) {
      selections.push(db.raw("vendor_payout_cents as vendor_pay_cents"));
    }
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

  return db("products")
    .select(
      selections.concat([
        db.raw(
          "(select min(price_cents) from product_variants v where v.product_id = products.id) as priceCents"
        ),
        db.raw(
          "(select min(price_cents) from product_variants v where v.product_id = products.id) as minVariantPriceCents"
        ),
      ])
    )
    .orderBy("created_at", "desc");
};

const getProductsByArtistId = async (artistId) => {
  const db = getDb();
  return db("products")
    .select(
      "id",
      "title",
      "description",
      "created_at",
      "updated_at",
      "artist_id as artistId",
      "is_active",
      "is_active as isActive",
      db.raw(
        "(select min(price_cents) from product_variants v where v.product_id = products.id) as minVariantPriceCents"
      )
    )
    .where({ artist_id: artistId })
    .orderBy("created_at", "desc");
};

const getProductById = async (id) => {
  const db = getDb();
  const product = await db("products")
    .select(
      "products.*",
      db.raw(
        "(select min(price_cents) from product_variants v where v.product_id = products.id) as priceCents"
      ),
      db.raw(
        "(select min(price_cents) from product_variants v where v.product_id = products.id) as minVariantPriceCents"
      )
    )
    .where({ id })
    .first();
  if (!product) {
    return null;
  }
  const variants = await db("product_variants")
    .select("id", "sku", "size", "color", "price_cents as priceCents", "stock")
    .where({ product_id: id });
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
  const vendorPayCentsParsed = parseMerchMoneyToCents({
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
  const ourShareCentsParsed = parseMerchMoneyToCents({
    body,
    centsKeys: ["our_share_cents", "ourShareCents"],
    amountKeys: ["our_share", "ourShare"],
    minCents: 0,
    required: true,
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
  if (!vendorPayCentsParsed.ok) {
    add("vendor_pay_cents", "vendor_pay_cents/vendor_pay must be a number >= 0");
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

  if (details.length > 0) return { ok: false, details };

  return {
    ok: true,
    value: {
      artistId,
      merchName,
      merchStory,
      mrpCents: mrpCentsParsed.value,
      vendorPayCents: vendorPayCentsParsed.value,
      ourShareCents: ourShareCentsParsed.value,
      royaltyCents: royaltyCentsParsed.value,
      merchType,
      colors: colorsResult.colors,
      listingFiles: listingValidation.listingFiles,
      description: readText(body.description),
    },
  };
};

const saveProductListingPhotos = async ({ trx, productId, files = [] }) => {
  fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });
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
      role: "listing_photo",
      sort_order: index,
      created_at: trx.fn.now(),
    });

    urls.push(publicUrl);
  }

  return urls;
};

const loadProductListingPhotos = async (productId) => {
  if (!productId) return [];
  const db = getDb();
  const hasEntityMediaLinks = await db.schema.hasTable("entity_media_links");
  const hasMediaAssets = await db.schema.hasTable("media_assets");
  if (!hasEntityMediaLinks || !hasMediaAssets) return [];

  const rows = await db("entity_media_links as eml")
    .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
    .where("eml.entity_type", "product")
    .andWhere("eml.entity_id", productId)
    .andWhere("eml.role", "listing_photo")
    .orderBy("eml.sort_order", "asc")
    .select("ma.public_url");

  return rows
    .map((row) => toAbsolutePublicUrl(row.public_url))
    .filter(Boolean);
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
      photos: [],
      primaryPhotoUrl: "",
    }));
  }

  const productIds = products.map((p) => p.id).filter(Boolean);
  if (!productIds.length) {
    return products.map((product) => ({
      ...product,
      listingPhotoUrls: [],
      photos: [],
      primaryPhotoUrl: "",
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
    photoUrls: byProductId.get(product.id) || [],
    photos: byProductId.get(product.id) || [],
    listingPhotoUrl: (byProductId.get(product.id) || [])[0] || "",
    primaryPhotoUrl: (byProductId.get(product.id) || [])[0] || "",
  }));
};

const replaceProductListingPhotos = async ({ trx, productId, files = [] }) => {
  await trx("entity_media_links")
    .where({
      entity_type: "product",
      entity_id: productId,
      role: "listing_photo",
    })
    .delete();

  return saveProductListingPhotos({
    trx,
    productId,
    files,
  });
};

const createProductWithVariants = async (input) => {
  const db = getDb();
  return db.transaction(async (trx) => {
    const productId = randomUUID();
    await trx("products").insert({
      id: productId,
      artist_id: input.artistId,
      title: input.title,
      description: input.description || null,
      is_active: input.isActive === undefined ? true : input.isActive,
    });

    const variantRows = input.variants.map((variant) => ({
      id: randomUUID(),
      product_id: productId,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      price_cents: variant.priceCents,
      stock: variant.stock,
    }));

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
  validateProductColors,
  parseMerchMoneyToCents,
  saveProductListingPhotos,
  replaceProductListingPhotos,
  loadProductListingPhotos,
  attachListingPhotosToProducts,
  createProductWithVariants,
};
