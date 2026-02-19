const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const {
  isUserLinkedToArtist,
  isLabelLinkedToArtist,
} = require("../../utils/ownership");

const router = express.Router();

const BAD_REQUEST = { error: "bad_request" };
const NOT_FOUND = { error: "drop_not_found" };
const PUBLIC_NOT_FOUND = { error: "not_found" };
const PRODUCT_NOT_FOUND = { error: "product_not_found" };
const DROP_REQUIRES_PRODUCTS = { error: "drop_requires_products" };

const isArtistDropsScope = (req) => req.baseUrl?.includes("/artist/drops");
const isAdminDropsScope = (req) => req.baseUrl?.includes("/admin/drops");
const setDropIdAliasDeprecationHeaders = (_req, res, next) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", "2026-04-15T00:00:00Z");
  res.setHeader("Link", "</api/drops/{handle}>; rel=\"alternate\"");
  next();
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
      .select("eml.entity_id as entityId", "ma.public_url as publicUrl")
      .where("eml.entity_type", entityType)
      .andWhere("eml.role", "cover")
      .whereIn("eml.entity_id", dedupedIds)
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

router.get("/", async (req, res, next) => {
  try {
    if (isArtistDropsScope(req)) {
      if (!req.user?.id) {
        return res.status(401).json({ error: "unauthorized" });
      }
      if (req.user.role !== "artist") {
        return res.status(403).json({ error: "forbidden" });
      }
      const db = getDb();
      const mappings = await db("artist_user_map")
        .select("artist_id")
        .where({ user_id: req.user.id });
      const artistIds = mappings
        .map((row) => row?.artist_id)
        .filter((value) => typeof value === "string" && value.length > 0);
      if (artistIds.length === 0) {
        return res.json({ items: [] });
      }

      const includeArchived =
        req.query?.includeArchived === "1" || req.query?.includeArchived === "true";

      const query = db("drops")
        .select(
          "id",
          "handle",
          "title",
          "description",
          "hero_image_url",
          "starts_at",
          "ends_at",
          "artist_id",
          "label_id",
          "status",
          "created_by_user_id",
          "created_at",
          "updated_at"
        )
        .whereIn("artist_id", artistIds);

      if (!includeArchived) {
        query.whereNot("status", "archived");
      }

      const rows = await query.orderBy("created_at", "desc").limit(100);
      const coverMap = await loadCoverUrlMap(
        "drop",
        rows.map((row) => row.id)
      );
      return res.json({
        items: rows.map((row) => ({
          ...formatDrop(row, coverMap.get(row.id) || null),
          slug: row.handle,
          start_at: row.starts_at,
          end_at: row.ends_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          artist_id: row.artist_id,
        })),
      });
    }

    if (isAdminDropsScope(req)) {
      if (!req.user?.id) {
        return res.status(401).json({ error: "unauthorized" });
      }
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "forbidden" });
      }

      const db = getDb();
      const rows = await db("drops")
        .select(
          "id",
          "handle",
          "title",
          "description",
          "hero_image_url",
          "starts_at",
          "ends_at",
          "artist_id",
          "label_id",
          "status",
          "created_by_user_id",
          "created_at",
          "updated_at"
        )
        .orderBy("updated_at", "desc")
        .limit(200);
      const coverMap = await loadCoverUrlMap(
        "drop",
        rows.map((row) => row.id)
      );
      return res.json({
        items: rows.map((row) => formatDrop(row, coverMap.get(row.id) || null)),
      });
    }

    const db = getDb();
    const rows = await db("drops")
      .select(
        "id",
        "handle",
        "title",
        "description",
        "hero_image_url",
        "starts_at",
        "ends_at",
        "artist_id",
        "label_id",
        "status",
        "created_by_user_id",
        "created_at",
        "updated_at"
      )
      .where({ status: "published" })
      .orderBy("updated_at", "desc")
      .limit(50);
    const coverMap = await loadCoverUrlMap(
      "drop",
      rows.map((row) => row.id)
    );
    return res.json({
      items: rows.map((row) => formatDrop(row, coverMap.get(row.id) || null)),
    });
  } catch (err) {
    next(err);
  }
});

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

router.get("/featured", async (req, res, next) => {
  try {
    const db = getDb();
    const rows = await db("drops")
      .select(
        "id",
        "handle",
        "title",
        "description",
        "hero_image_url",
        "starts_at",
        "ends_at",
        "artist_id",
        "label_id",
        "status",
        "created_by_user_id",
        "created_at",
        "updated_at"
      )
      .where({ status: "published" })
      .orderBy("updated_at", "desc")
      .limit(12);
    const coverMap = await loadCoverUrlMap(
      "drop",
      rows.map((row) => row.id)
    );
    res.json({
      items: rows.map((row) => formatDrop(row, coverMap.get(row.id) || null)),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/products", async (req, res, next) => {
  try {
    if (!isAdminDropsScope(req)) {
      return next();
    }
    if (!req.user?.id) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    const dropId = String(req.params?.id || "").trim();
    if (!isUuid(dropId)) {
      return res.status(400).json(BAD_REQUEST);
    }

    const db = getDb();
    const drop = await db("drops").select("id").where({ id: dropId }).first();
    if (!drop) {
      return res.status(404).json(NOT_FOUND);
    }

    const rows = await db("drop_products as dp")
      .join("products as p", "p.id", "dp.product_id")
      .leftJoin("product_variants as pv", "pv.product_id", "p.id")
      .select(
        "p.id",
        "p.title",
        "p.artist_id",
        db.raw("min(pv.price_cents) as price_cents")
      )
      .where("dp.drop_id", dropId)
      .groupBy("p.id", "p.title", "p.artist_id")
      .orderBy("p.title", "asc");

    const productIds = rows.map((row) => row.id);
    return res.json({
      drop_id: dropId,
      product_ids: productIds,
      products: rows.map((row) => ({
        id: row.id,
        title: row.title,
        artist_id: row.artist_id,
        price_cents: row.price_cents == null ? null : Number(row.price_cents),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/products", requireAuth, async (req, res, next) => {
  try {
    if (!isAdminDropsScope(req)) {
      return next();
    }
    if (!req.user?.id) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    const dropId = String(req.params?.id || "").trim();
    if (!isUuid(dropId)) {
      return res.status(400).json(BAD_REQUEST);
    }

    const body = req.body || {};
    const productIdsRaw = body.product_ids;
    if (!Array.isArray(productIdsRaw)) {
      return res.status(400).json(BAD_REQUEST);
    }

    const normalizedProductIds = Array.from(
      new Set(
        productIdsRaw
          .map((value) => String(value || "").trim())
          .filter((value) => value.length > 0)
      )
    );

    if (normalizedProductIds.some((id) => !isUuid(id))) {
      return res.status(400).json({ error: "invalid_product_ids" });
    }

    const db = getDb();
    const drop = await db("drops").select("id").where({ id: dropId }).first();
    if (!drop) {
      return res.status(404).json(NOT_FOUND);
    }

    if (normalizedProductIds.length > 0) {
      const existingProducts = await db("products")
        .select("id")
        .whereIn("id", normalizedProductIds);
      const existingProductIds = new Set(existingProducts.map((row) => row.id));
      const missing = normalizedProductIds.filter((id) => !existingProductIds.has(id));
      if (missing.length > 0) {
        return res.status(400).json({ error: "invalid_product_ids", missing });
      }
    }

    await db.transaction(async (trx) => {
      await trx("drop_products").where({ drop_id: dropId }).del();
      if (normalizedProductIds.length > 0) {
        const now = trx.fn.now();
        const rows = normalizedProductIds.map((productId, index) => ({
          drop_id: dropId,
          product_id: productId,
          sort_order: index,
          created_at: now,
        }));
        await trx("drop_products").insert(rows);
      }
      await trx("drops").where({ id: dropId }).update({ updated_at: trx.fn.now() });
    });

    const updatedRows = await db("drop_products as dp")
      .join("products as p", "p.id", "dp.product_id")
      .leftJoin("product_variants as pv", "pv.product_id", "p.id")
      .select(
        "p.id",
        "p.title",
        "p.artist_id",
        db.raw("min(pv.price_cents) as price_cents")
      )
      .where("dp.drop_id", dropId)
      .groupBy("p.id", "p.title", "p.artist_id")
      .orderBy("p.title", "asc");

    const updatedProductIds = updatedRows.map((row) => row.id);
    return res.json({
      drop_id: dropId,
      product_ids: updatedProductIds,
      products: updatedRows.map((row) => ({
        id: row.id,
        title: row.title,
        artist_id: row.artist_id,
        price_cents: row.price_cents == null ? null : Number(row.price_cents),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", requireAuth, rejectLabelMutations, async (req, res, next) => {
  try {
    if (!isAdminDropsScope(req)) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!req.user?.id) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json(BAD_REQUEST);
    }

    const db = getDb();
    const existing = await db("drops").where({ id }).first();
    if (!existing) {
      return res.status(404).json(NOT_FOUND);
    }

    const body = req.body || {};
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      const nextTitle = String(body.title || "").trim();
      if (!nextTitle) {
        return res.status(400).json(BAD_REQUEST);
      }
      updates.title = nextTitle;
    }

    if (Object.prototype.hasOwnProperty.call(body, "handle")) {
      const normalized = normalizeHandle(body.handle);
      if (!normalized) {
        return res.status(400).json(BAD_REQUEST);
      }
      const duplicate = await db("drops")
        .whereRaw("lower(handle) = ?", [normalized])
        .whereNot({ id })
        .first();
      if (duplicate) {
        return res.status(409).json({ error: "handle_conflict" });
      }
      updates.handle = normalized;
    }

    if (Object.prototype.hasOwnProperty.call(body, "description")) {
      updates.description = body.description == null ? null : String(body.description);
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "hero_image_url") ||
      Object.prototype.hasOwnProperty.call(body, "heroImageUrl")
    ) {
      const heroValue = Object.prototype.hasOwnProperty.call(body, "hero_image_url")
        ? body.hero_image_url
        : body.heroImageUrl;
      updates.hero_image_url = heroValue == null ? null : String(heroValue).trim() || null;
    }

    const parseTimestamp = (value) => {
      if (value == null || value === "") return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return undefined;
      return parsed.toISOString();
    };

    let startsAt = existing.starts_at;
    let endsAt = existing.ends_at;

    if (Object.prototype.hasOwnProperty.call(body, "starts_at")) {
      const parsed = parseTimestamp(body.starts_at);
      if (parsed === undefined) {
        return res.status(400).json({ error: "invalid_starts_at" });
      }
      startsAt = parsed;
      updates.starts_at = parsed;
    }

    if (Object.prototype.hasOwnProperty.call(body, "ends_at")) {
      const parsed = parseTimestamp(body.ends_at);
      if (parsed === undefined) {
        return res.status(400).json({ error: "invalid_ends_at" });
      }
      endsAt = parsed;
      updates.ends_at = parsed;
    }

    if (startsAt && endsAt) {
      const startsAtMs = new Date(startsAt).getTime();
      const endsAtMs = new Date(endsAt).getTime();
      if (endsAtMs < startsAtMs) {
        return res.status(400).json({ error: "invalid_time_range" });
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "quiz_json")) {
      updates.quiz_json = body.quiz_json == null ? null : body.quiz_json;
    }

    updates.updated_at = db.fn.now();

    await db("drops").where({ id }).update(updates);
    const updated = await db("drops").where({ id }).first();
    return res.json({ drop: formatDrop(updated) });
  } catch (err) {
    next(err);
  }
});

router.get("/:handle", async (req, res, next) => {
  try {
    const { handle } = req.params;
    if (!handle) {
      return res.status(400).json(BAD_REQUEST);
    }
    const drop = await loadPublishedDrop(handle);
    if (!drop) {
      return res.status(404).json(PUBLIC_NOT_FOUND);
    }
    res.json({ drop: formatDrop(drop) });
  } catch (err) {
    next(err);
  }
});

router.get("/id/:id", setDropIdAliasDeprecationHeaders, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json(BAD_REQUEST);
    }
    const drop = await loadPublishedDropById(id);
    if (!drop) {
      return res.status(404).json(PUBLIC_NOT_FOUND);
    }
    res.json({ drop: formatDrop(drop) });
  } catch (err) {
    next(err);
  }
});

router.get("/:handle/products", async (req, res, next) => {
  try {
    const { handle } = req.params;
    if (!handle) {
      return res.status(400).json(BAD_REQUEST);
    }
    const drop = await loadPublishedDrop(handle);
    if (!drop) {
      return res.status(404).json(PUBLIC_NOT_FOUND);
    }
    const db = getDb();
    const rows = await db("drop_products as dp")
      .join("products as p", "dp.product_id", "p.id")
      .select("p.id", "p.title", "p.artist_id", "p.is_active")
      .where("dp.drop_id", drop.id)
      .orderBy("dp.sort_order", "asc")
      .orderBy("p.created_at", "desc");
    res.json({ items: rows.map(formatProduct) });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  requireAuth,
  rejectLabelMutations,
  requirePolicy("drop:create", "self", createDropCtx),
  async (req, res, next) => {
    try {
      const isAdminScope = isAdminDropsScope(req);
      const {
        handle,
        slug,
        title,
        description,
        heroImageUrl,
        artistId,
        labelId,
        startsAt,
        endsAt,
      } = req.body || {};

      if (!title) {
        return res.status(400).json(BAD_REQUEST);
      }

      if (isAdminScope && req.user.role !== "admin") {
        return res.status(403).json({ error: "forbidden" });
      }

      const db = getDb();

      let resolvedArtistId = artistId || null;
      let resolvedLabelId = labelId || null;
      if (!resolvedArtistId && !resolvedLabelId) {
        if (isAdminScope) {
          const fallbackArtist = await db("artists").select("id").orderBy("created_at", "asc").first();
          if (fallbackArtist?.id) {
            resolvedArtistId = fallbackArtist.id;
          }
        }
      }

      if (!resolvedArtistId && !resolvedLabelId) {
        return res.status(400).json(BAD_REQUEST);
      }

      if (resolvedArtistId && resolvedLabelId) {
        return res.status(400).json(BAD_REQUEST);
      }

      const rawHandle = handle || slug || title;
      const normalizedHandle = normalizeHandle(rawHandle);
      if (!normalizedHandle) {
        return res.status(400).json(BAD_REQUEST);
      }

      let uniqueHandle = normalizedHandle;
      let suffix = 1;
      // Keep handles unique while preserving deterministic slugging.
      while (await db("drops").where({ handle: uniqueHandle }).first()) {
        suffix += 1;
        uniqueHandle = `${normalizedHandle}-${suffix}`;
      }

      const id = randomUUID();
      const now = db.fn.now();
      await db("drops").insert({
        id,
        handle: uniqueHandle,
        title,
        description: description || null,
        hero_image_url: heroImageUrl || null,
        status: "draft",
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        artist_id: resolvedArtistId,
        label_id: resolvedLabelId,
        created_by_user_id: req.user.id,
        created_at: now,
        updated_at: now,
      });

      const drop = await db("drops").where({ id }).first();
      res.status(201).json({ drop: formatDrop(drop) });
    } catch (err) {
      next(err);
    }
  }
);

const formatDrop = (row, coverUrl = null) => {
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    description: row.description,
    heroImageUrl: row.hero_image_url,
    coverUrl,
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
  };
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


router.post(
  "/:handle/products",
  requireAuth,
  rejectLabelMutations,
  attachDrop,
  requirePolicy("drop:add-product", "self", manageDropCtx),
  async (req, res, next) => {
    try {
      const productId = req.body?.productId;
      const sortOrder =
        typeof req.body?.sortOrder === "number" ? req.body.sortOrder : 0;
      if (!productId) {
        return res.status(400).json(BAD_REQUEST);
      }

      const db = getDb();
      const product = await db("products").where({ id: productId }).first();
      if (!product) {
        return res.status(404).json(PRODUCT_NOT_FOUND);
      }

      if (req.drop.artist_id) {
        if (product.artist_id !== req.drop.artist_id) {
          return res.status(403).json({ error: "forbidden" });
        }
        const owns = await isUserLinkedToArtist(
          db,
          req.user.id,
          req.drop.artist_id
        );
        if (!owns) {
          return res.status(403).json({ error: "forbidden" });
        }
      } else if (req.drop.label_id) {
        const owns = await isLabelLinkedToArtist(
          db,
          req.drop.label_id,
          product.artist_id
        );
        if (!owns) {
          return res.status(403).json({ error: "forbidden" });
        }
      } else {
        return res.status(403).json({ error: "forbidden" });
      }

      await db("drop_products")
        .insert({
          drop_id: req.drop.id,
          product_id: productId,
          sort_order: sortOrder,
          created_at: db.fn.now(),
        })
        .onConflict(["drop_id", "product_id"])
        .merge({ sort_order: sortOrder });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:handle/publish",
  requireAuth,
  rejectLabelMutations,
  attachDrop,
  requirePolicy("drop:publish", "self", manageDropCtx),
  async (req, res, next) => {
    try {
      if (isArtistDropsScope(req)) {
        if (req.drop.status === "archived") {
          return res.status(400).json({ error: "invalid_status_transition" });
        }
        if (req.drop.status === "published") {
          return res.json({ drop: formatDrop(req.drop) });
        }
        if (req.drop.status !== "draft") {
          return res.status(400).json({ error: "invalid_status_transition" });
        }
      }

      const db = getDb();
      const count = await db("drop_products")
        .where({ drop_id: req.drop.id })
        .count("product_id as total")
        .first();
      if (!count || Number(count.total) === 0) {
        return res.status(400).json(DROP_REQUIRES_PRODUCTS);
      }

      await db("drops")
        .where({ id: req.drop.id })
        .update({ status: "published", updated_at: db.fn.now() });

      const drop = await db("drops").where({ id: req.drop.id }).first();
      res.json({ drop: formatDrop(drop) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:handle/unpublish",
  requireAuth,
  rejectLabelMutations,
  attachDrop,
  requirePolicy("drop:unpublish", "self", manageDropCtx),
  async (req, res, next) => {
    try {
      if (isArtistDropsScope(req)) {
        if (req.drop.status === "archived") {
          return res.status(400).json({ error: "invalid_status_transition" });
        }
        if (req.drop.status === "draft") {
          return res.json({ drop: formatDrop(req.drop) });
        }
        if (req.drop.status !== "published") {
          return res.status(400).json({ error: "invalid_status_transition" });
        }
      }

      const db = getDb();
      await db("drops")
        .where({ id: req.drop.id })
        .update({ status: "draft", updated_at: db.fn.now() });

      const drop = await db("drops").where({ id: req.drop.id }).first();
      res.json({ drop: formatDrop(drop) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:handle/archive",
  requireAuth,
  rejectLabelMutations,
  attachDrop,
  requirePolicy("drop:archive", "self", manageDropCtx),
  async (req, res, next) => {
    try {
      if (isArtistDropsScope(req)) {
        return res.status(403).json({ error: "forbidden" });
      }
      const db = getDb();
      await db("drops")
        .where({ id: req.drop.id })
        .update({ status: "archived", updated_at: db.fn.now() });

      const drop = await db("drops").where({ id: req.drop.id }).first();
      res.json({ drop: formatDrop(drop) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
