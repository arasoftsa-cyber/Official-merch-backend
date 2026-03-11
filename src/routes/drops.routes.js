const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { requireAuth } = require("../core/http/auth.middleware");
const { requirePolicy } = require("../core/http/policy.middleware");
const { getStorageProvider } = require("../storage");
const { finalizeUploadedMedia } = require("../storage/mediaUploadLifecycle");
const { createMediaAsset } = require("../services/mediaAssets.service");
const {
  isUserLinkedToArtist,
  isLabelLinkedToArtist,
} = require("../utils/ownership");
const {
  buildSellableMinPriceSubquery,
  applySellableVariantExists,
} = require("../services/variantAvailability.service");

const { registerDropsListingRoutes } = require("./drops/listing.routes");
const { registerDropsAdminRoutes } = require("./drops/admin.routes");
const { registerDropsPublicRoutes } = require("./drops/public.routes");
const { registerDropsManageRoutes } = require("./drops/manage.routes");

const router = express.Router();

const BAD_REQUEST = { error: "bad_request" };
const NOT_FOUND = { error: "drop_not_found" };
const PUBLIC_NOT_FOUND = { error: "not_found" };
const PRODUCT_NOT_FOUND = { error: "product_not_found" };
const DROP_REQUIRES_PRODUCTS = { error: "drop_requires_products" };
const MAX_DROP_HERO_MULTIPART_BYTES = 6 * 1024 * 1024;
const MAX_DROP_HERO_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_DROP_HERO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DROP_HERO_EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const storageProvider = getStorageProvider();

const isArtistDropsScope = (req) => req.baseUrl?.includes("/artist/drops");
const isAdminDropsScope = (req) => req.baseUrl?.includes("/admin/drops");
const getArtistIdsForUser = async (db, userId) => {
  if (!db || !userId) return [];
  const rows = await db("artist_user_map").select("artist_id").where({ user_id: userId });
  return rows
    .map((row) => row?.artist_id)
    .filter((value) => typeof value === "string" && value.length > 0);
};
const setDropIdAliasDeprecationHeaders = (_req, res, next) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", "2026-04-15T00:00:00Z");
  res.setHeader("Link", "</api/drops/{handle}>; rel=\"alternate\"");
  next();
};

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
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return null;
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    return { fields: {}, file: null, parseError: "missing_boundary" };
  }

  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_DROP_HERO_MULTIPART_BYTES) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  }).catch((error) => ({ parseError: error.message }));

  if (body?.parseError) {
    return { fields: {}, file: null, parseError: body.parseError };
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const rawParts = splitBufferBy(body, delimiter);
  const fields = {};
  let file = null;

  for (const rawPart of rawParts) {
    if (!rawPart || rawPart.length === 0) continue;
    let part = rawPart;
    if (part.subarray(0, 2).toString() === "\r\n") {
      part = part.subarray(2);
    }
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
      file = {
        fieldname: name,
        originalname: filename,
        mimetype: mimeType.toLowerCase(),
        buffer: content,
      };
      continue;
    }

    fields[name] = content.toString("utf8");
  }

  return { fields, file };
};

const saveDropHeroImage = async (file) => {
  const ext = DROP_HERO_EXT_BY_MIME[file.mimetype] || "";
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const relativePath = path.posix.join("media-assets", "drops", filename);
  const saved = await storageProvider.saveFile({
    relativePath,
    buffer: file.buffer,
  });
  const storageResult = await finalizeUploadedMedia({ saved, file, relativePath });
  return storageResult.publicUrl;
};

const loadCoverUrlMap = async (entityType, entityIds) => {
  if (!entityType || !Array.isArray(entityIds) || entityIds.length === 0) {
    return new Map();
  }

  const db = getDb();
  const dedupedIds = Array.from(new Set(entityIds.filter(Boolean)));
  if (dedupedIds.length === 0) {
    return new Map();
  }

  try {
    const hasMediaAssets = await db.schema.hasTable("media_assets");
    const hasEntityLinks = await db.schema.hasTable("entity_media_links");
    if (!hasMediaAssets || !hasEntityLinks) {
      return new Map();
    }

    const rows = await db("entity_media_links as eml")
      .join("media_assets as ma", "ma.id", "eml.media_asset_id")
      .select("eml.entity_id as entityId", "ma.public_url as publicUrl", "eml.role")
      .where("eml.entity_type", entityType)
      .whereIn("eml.role", ["hero", "cover"])
      .whereIn("eml.entity_id", dedupedIds)
      .orderByRaw("case when eml.role = 'hero' then 0 when eml.role = 'cover' then 1 else 2 end")
      .orderBy("eml.sort_order", "asc")
      .orderBy("eml.created_at", "asc");

    const map = new Map();
    for (const row of rows) {
      if (row?.entityId && !map.has(row.entityId)) {
        map.set(row.entityId, row.publicUrl || null);
      }
    }
    return map;
  } catch {
    return new Map();
  }
};

const syncDropHeroImageUrlColumn = async (trx, dropId, heroUrl) => {
  const hasColumn = await trx.schema.hasColumn("drops", "hero_image_url");
  if (!hasColumn) return;

  await trx("drops").where({ id: dropId }).update({
    hero_image_url: heroUrl || null,
    updated_at: trx.fn.now(),
  });
};

const upsertDropHeroMedia = async (trx, dropId, heroUrl) => {
  const normalizedHeroUrl = String(heroUrl || "").trim();

  if (!normalizedHeroUrl) {
    await trx("entity_media_links")
      .where({
        entity_type: "drop",
        entity_id: dropId,
      })
      .whereIn("role", ["hero", "cover"])
      .del();
    await syncDropHeroImageUrlColumn(trx, dropId, null);
    return null;
  }

  let mediaAssetId;
  const existingAsset = await trx("media_assets").where({ public_url: normalizedHeroUrl }).first();
  if (existingAsset) {
    mediaAssetId = existingAsset.id;
  } else {
    mediaAssetId = randomUUID();
    await createMediaAsset({
      trx,
      id: mediaAssetId,
      publicUrl: normalizedHeroUrl,
    });
  }

  await trx("entity_media_links")
    .where({
      entity_type: "drop",
      entity_id: dropId,
      role: "hero",
    })
    .del();

  await trx("entity_media_links").insert({
    id: randomUUID(),
    media_asset_id: mediaAssetId,
    entity_type: "drop",
    entity_id: dropId,
    role: "hero",
    sort_order: 0,
    created_at: trx.fn.now(),
  });

  const existingCoverLink = await trx("entity_media_links")
    .where({
      entity_type: "drop",
      entity_id: dropId,
      role: "cover",
    })
    .first();

  if (existingCoverLink) {
    await trx("entity_media_links").where({ id: existingCoverLink.id }).update({
      media_asset_id: mediaAssetId,
      sort_order: 0,
    });
  } else {
    await trx("entity_media_links").insert({
      id: randomUUID(),
      media_asset_id: mediaAssetId,
      entity_type: "drop",
      entity_id: dropId,
      role: "cover",
      sort_order: 0,
      created_at: trx.fn.now(),
    });
  }

  await syncDropHeroImageUrlColumn(trx, dropId, normalizedHeroUrl);
  return normalizedHeroUrl;
};


const loadDropByIdentifier = async (identifier) => {
  if (!identifier) return null;
  const db = getDb();
  if (isUuid(identifier)) {
    const byId = await db("drops").where({ id: identifier }).first();
    if (byId) return byId;
  }
  return db("drops").where({ handle: identifier }).first();
};

const normalizeHandle = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);


const formatDrop = (row, coverUrl = null) => {
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    description: row.description,
    heroImageUrl: coverUrl || row.hero_image_url || null,
    coverUrl: coverUrl || row.hero_image_url || null,
    quiz_json: row.quiz_json || null,
    quizJson: row.quiz_json || null,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    artistId: row.artist_id,
    labelId: row.label_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const formatProduct = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    artistId: row.artist_id,
    isActive: row.is_active,
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
  };
};

const applyDropProductOrdering = (query, { includeCreatedAt = true } = {}) => {
  if (!query) return query;
  if (includeCreatedAt) {
    query.select("p.created_at");
    query.groupBy("p.created_at");
  }
  query.select(query.client.raw("min(dp.sort_order) as drop_sort_order"));
  query.groupBy("p.id", "p.title", "p.artist_id", "p.is_active");
  query.orderBy("drop_sort_order", "asc");
  query.orderBy("p.created_at", "desc");
  return query;
};

const applyPublicActiveProductFilter = (
  query,
  { productRef = "p", hasStatus = false, hasIsActive = true } = {}
) => {
  if (!query) return query;
  const statusField = `${productRef}.status`;
  const activeField = `${productRef}.is_active`;
  if (hasStatus) {
    query.andWhere(statusField, "active");
  } else if (hasIsActive) {
    query.andWhere(activeField, true);
  } else {
    query.whereRaw("1 = 0");
  }
  return query;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);

const loadPublishedDrop = async (handle) => {
  if (!handle) return null;
  const db = getDb();
  // Public drop reads are handle-based by contract.
  return db("drops").where({ status: "published", handle }).first();
};

const loadPublishedDropById = async (id) => {
  if (!id) return null;
  const db = getDb();
  return db("drops").where({ status: "published", id }).first();
};

const attachDrop = async (req, res, next) => {
  const dropKey = req.params?.handle || req.params?.id;
  const drop = await loadDropByIdentifier(dropKey);
  if (!drop) {
    return res.status(404).json(NOT_FOUND);
  }
  req.drop = drop;
  next();
};

function createDropCtx(req) {
  return {
    db: getDb(),
    userId: req.user?.id,
    artistId: req.body?.artistId,
    labelId: req.body?.labelId,
  };
}

function manageDropCtx(req) {
  return {
    db: getDb(),
    userId: req.user?.id,
    drop: req.drop,
  };
}

function rejectLabelMutations(req, res, next) {
  if (req.user?.role === "label") {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
}



registerDropsListingRoutes(router, {
  getDb,
  isArtistDropsScope,
  isAdminDropsScope,
  getArtistIdsForUser,
  loadCoverUrlMap,
  formatDrop,
});

registerDropsAdminRoutes(router, {
  requireAuth,
  rejectLabelMutations,
  isAdminDropsScope,
  isUuid,
  BAD_REQUEST,
  NOT_FOUND,
  getDb,
  buildSellableMinPriceSubquery,
  applySellableVariantExists,
  parseMultipartFormData,
  MAX_DROP_HERO_IMAGE_BYTES,
  ALLOWED_DROP_HERO_MIME_TYPES,
  saveDropHeroImage,
  upsertDropHeroMedia,
  loadCoverUrlMap,
  formatDrop,
  normalizeHandle,
});

registerDropsPublicRoutes(router, {
  setDropIdAliasDeprecationHeaders,
  BAD_REQUEST,
  PUBLIC_NOT_FOUND,
  loadPublishedDrop,
  loadPublishedDropById,
  loadCoverUrlMap,
  formatDrop,
  getDb,
  buildSellableMinPriceSubquery,
  applyPublicActiveProductFilter,
  applySellableVariantExists,
  applyDropProductOrdering,
  formatProduct,
});

registerDropsManageRoutes(router, {
  requireAuth,
  rejectLabelMutations,
  requirePolicy,
  createDropCtx,
  manageDropCtx,
  attachDrop,
  isArtistDropsScope,
  isAdminDropsScope,
  BAD_REQUEST,
  PRODUCT_NOT_FOUND,
  DROP_REQUIRES_PRODUCTS,
  getDb,
  randomUUID,
  normalizeHandle,
  upsertDropHeroMedia,
  formatDrop,
  isUserLinkedToArtist,
  isLabelLinkedToArtist,
});

module.exports = router;
module.exports.__test = {
  applyDropProductOrdering,
  applyPublicActiveProductFilter,
};
