const registerDropsManageRoutes = (router, deps) => {
  const {
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
  } = deps;

router.post(
  "/",
  requireAuth,
  rejectLabelMutations,
  requirePolicy("drop:create", "self", createDropCtx),
  async (req, res, next) => {
    try {
      if (isArtistDropsScope(req)) {
        return res.status(403).json({ error: "forbidden" });
      }
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

      await db.transaction(async (trx) => {
        const id = randomUUID();
        const now = trx.fn.now();
        await trx("drops").insert({
          id,
          handle: uniqueHandle,
          title,
          description: description || null,
          status: "draft",
          starts_at: startsAt || null,
          ends_at: endsAt || null,
          artist_id: resolvedArtistId,
          label_id: resolvedLabelId,
          created_by_user_id: req.user.id,
          created_at: now,
          updated_at: now,
        });

        const heroUrl = (heroImageUrl || "").trim();
        if (heroUrl) {
          await upsertDropHeroMedia(trx, id, heroUrl);
        }

        const drop = await trx("drops").where({ id }).first();
        const coverUrl = heroUrl || null;
        res.status(201).json({ drop: formatDrop(drop, coverUrl) });
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:handle/products",
  requireAuth,
  rejectLabelMutations,
  attachDrop,
  requirePolicy("drop:add-product", "self", manageDropCtx),
  async (req, res, next) => {
    try {
      if (isArtistDropsScope(req)) {
        return res.status(403).json({ error: "forbidden" });
      }
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

      if (req.user?.role !== "admin") {
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
        const db = getDb();
        const owns = req.drop.artist_id
          ? await isUserLinkedToArtist(db, req.user.id, req.drop.artist_id)
          : false;
        if (!owns) {
          return res.status(403).json({ error: "forbidden" });
        }
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
        const db = getDb();
        const owns = req.drop.artist_id
          ? await isUserLinkedToArtist(db, req.user.id, req.drop.artist_id)
          : false;
        if (!owns) {
          return res.status(403).json({ error: "forbidden" });
        }
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
};

module.exports = { registerDropsManageRoutes };
