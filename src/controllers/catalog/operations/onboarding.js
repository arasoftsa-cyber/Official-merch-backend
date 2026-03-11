const {
  validateDesignImageFile,
  validateListingPhotoFiles,
  normalizeSkuTypes,
  saveProductDesignImage,
  replaceProductListingPhotos,
  loadProductDesignImagesMap,
  attachListingPhotosToProducts,
} = require("../../../services/catalog.service");
const { getDb } = require("../../../core/db/db");
const { getTableColumns } = require("../../../core/db/schemaCache");
const { parseMultipartFormData } = require("../multipart");
const {
  PRODUCT_STATUS_PENDING,
  PRODUCT_STATUS_INACTIVE,
  PRODUCT_STATUS_REJECTED,
  normalizeProductStatusValue,
  normalizeProductStatusFromRecord,
  withStatus,
} = require("../status");
const { isAdmin, isArtist } = require("../auth");
const { mapMultipartParseError } = require("../helpers/validation");
const { BAD_REQUEST, NOT_FOUND } = require("../helpers/http");
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
  const multipartError = mapMultipartParseError(multipart);
  if (multipartError) return res.status(400).json(multipartError);

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
  const multipartError = mapMultipartParseError(multipart);
  if (multipartError) return res.status(400).json(multipartError);

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

module.exports = {
  createArtistOnboardingRequest,
  listAdminOnboardingRequests,
  approveOnboardingRequest,
  rejectOnboardingRequest,
  parseOnboardingSkuTypes,
};
