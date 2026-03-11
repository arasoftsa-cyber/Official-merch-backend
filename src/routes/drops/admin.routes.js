const registerDropsAdminRoutes = (router, deps) => {
  const {
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
  } = deps;

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

    const productsQuery = db("drop_products as dp")
      .join("products as p", "p.id", "dp.product_id")
      .select(
        "p.id",
        "p.title",
        "p.artist_id",
        buildSellableMinPriceSubquery(db, { productRef: "p.id" }).wrap("(", ") as price_cents")
      )
      .where("dp.drop_id", dropId)
      .groupBy("p.id", "p.title", "p.artist_id")
      .orderBy("p.title", "asc");
    applySellableVariantExists(productsQuery, { productRef: "p.id" });
    const rows = await productsQuery;

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

    const updatedProductsQuery = db("drop_products as dp")
      .join("products as p", "p.id", "dp.product_id")
      .select(
        "p.id",
        "p.title",
        "p.artist_id",
        buildSellableMinPriceSubquery(db, { productRef: "p.id" }).wrap("(", ") as price_cents")
      )
      .where("dp.drop_id", dropId)
      .groupBy("p.id", "p.title", "p.artist_id")
      .orderBy("p.title", "asc");
    applySellableVariantExists(updatedProductsQuery, { productRef: "p.id" });
    const updatedRows = await updatedProductsQuery;

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

router.post("/:id/hero-image", requireAuth, rejectLabelMutations, async (req, res, next) => {
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

    const dropId = String(req.params?.id || "").trim();
    if (!isUuid(dropId)) {
      return res.status(400).json(BAD_REQUEST);
    }

    const db = getDb();
    const drop = await db("drops").select("id").where({ id: dropId }).first();
    if (!drop) {
      return res.status(404).json(NOT_FOUND);
    }

    const multipart = await parseMultipartFormData(req);
    if (!multipart || multipart.parseError) {
      return res.status(400).json({ error: "validation_error", field: "file" });
    }

    const upload = multipart.file;
    if (!upload || !upload.buffer?.length) {
      return res.status(400).json({ error: "validation_error", field: "file" });
    }
    if (upload.fieldname !== "file" && upload.fieldname !== "image") {
      return res.status(400).json({ error: "validation_error", field: "file" });
    }
    if (upload.buffer.length > MAX_DROP_HERO_IMAGE_BYTES) {
      return res.status(400).json({ error: "validation_error", field: "file" });
    }
    if (!ALLOWED_DROP_HERO_MIME_TYPES.has(upload.mimetype)) {
      return res.status(400).json({ error: "validation_error", field: "file" });
    }

    const relativeUrl = await saveDropHeroImage(upload);

    await db.transaction(async (trx) => {
      await upsertDropHeroMedia(trx, dropId, relativeUrl);
    });

    const coverMap = await loadCoverUrlMap("drop", [dropId]);
    const updatedDrop = await db("drops").where({ id: dropId }).first();
    const heroImageUrl = coverMap.get(dropId) || relativeUrl;

    return res.status(201).json({
      ok: true,
      public_url: relativeUrl,
      heroImageUrl,
      drop: formatDrop(updatedDrop, heroImageUrl),
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

    await db.transaction(async (trx) => {
      if (Object.keys(updates).length > 0) {
        await trx("drops").where({ id }).update(updates);
      }

      if (
        Object.prototype.hasOwnProperty.call(body, "hero_image_url") ||
        Object.prototype.hasOwnProperty.call(body, "heroImageUrl")
      ) {
        const heroValue = Object.prototype.hasOwnProperty.call(body, "hero_image_url")
          ? body.hero_image_url
          : body.heroImageUrl;
        const heroUrl = heroValue == null ? "" : String(heroValue).trim();
        await upsertDropHeroMedia(trx, id, heroUrl);
      }
    });

    const coverMap = await loadCoverUrlMap("drop", [id]);
    const updated = await db("drops").where({ id }).first();
    return res.json({ drop: formatDrop(updated, coverMap.get(id)) });
  } catch (err) {
    next(err);
  }
});
};

module.exports = { registerDropsAdminRoutes };
