const {
  resolveOurShareCents,
  isNonNegativeInteger,
} = require("../../utils/economics");
const {
  ALLOWED_PRODUCT_COLORS,
  LISTING_PHOTO_FIELD_NAMES,
  LISTING_PHOTO_COLLECTION_FIELDS,
  NEW_MERCH_TRIGGER_FIELDS,
  ONBOARDING_ALLOWED_SKU_TYPES,
  DESIGN_IMAGE_FIELD_NAMES,
  ALLOWED_DESIGN_IMAGE_MIME_TYPES,
  ALLOWED_DESIGN_IMAGE_EXTENSIONS,
} = require("./constants");
const {
  readText,
  firstPresent,
  parseNonNegativeInt,
  normalizeColors,
  deriveSellingPriceFromSplit,
} = require("./helpers");

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

module.exports = {
  parseMerchMoneyToCents,
  validateProductColors,
  validateListingPhotoFiles,
  validateDesignImageFile,
  normalizeSkuTypes,
  detectNewMerchFlow,
  validateNewMerch,
  ONBOARDING_ALLOWED_SKU_TYPES,
};

