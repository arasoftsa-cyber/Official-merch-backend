const registerDropsListingRoutes = (router, deps) => {
  const {
    getDb,
    isArtistDropsScope,
    isAdminDropsScope,
    getArtistIdsForUser,
    loadCoverUrlMap,
    formatDrop,
  } = deps;

router.get("/", async (req, res, next) => {
  try {
    if (isArtistDropsScope(req)) {
      if (!req.user?.id) {
        return res.status(401).json({ error: "unauthorized" });
      }
      const db = getDb();
      const artistIds = await getArtistIdsForUser(db, req.user.id);
      if (artistIds.length === 0) {
        return res.json({ items: [] });
      }

      const includeArchived =
        req.query?.includeArchived === "1" || req.query?.includeArchived === "true";

      const query = db("drops")
        .leftJoin("drop_products as dp", "dp.drop_id", "drops.id")
        .leftJoin("entity_media_links as eml", function () {
          this.on("eml.entity_id", "=", "drops.id")
            .andOn("eml.entity_type", "=", db.raw("'drop'"))
            .andOn("eml.role", "=", db.raw("'cover'"));
        })
        .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
        .select(
          "drops.id",
          "drops.handle",
          "drops.title",
          "drops.description",
          "ma.public_url as hero_image_url",
          "drops.starts_at",
          "drops.ends_at",
          "drops.artist_id",
          "drops.label_id",
          "drops.status",
          "drops.created_by_user_id",
          "drops.created_at",
          "drops.updated_at",
          db.raw("count(distinct dp.product_id)::int as product_count")
        )
        .whereIn("drops.artist_id", artistIds)
        .groupBy(
          "drops.id",
          "drops.handle",
          "drops.title",
          "drops.description",
          "ma.public_url",
          "drops.starts_at",
          "drops.ends_at",
          "drops.artist_id",
          "drops.label_id",
          "drops.status",
          "drops.created_by_user_id",
          "drops.created_at",
          "drops.updated_at"
        );

      if (!includeArchived) {
        query.whereNot("drops.status", "archived");
      }

      const rows = await query.orderBy("drops.created_at", "desc").limit(100);
      const coverMap = await loadCoverUrlMap(
        "drop",
        rows.map((row) => row.id)
      );
      return res.json({
        items: rows.map((row) => ({
          ...formatDrop(row, coverMap.get(row.id)),
          slug: row.handle,
          start_at: row.starts_at,
          end_at: row.ends_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          artist_id: row.artist_id,
          product_count: Number(row.product_count ?? 0),
          productCount: Number(row.product_count ?? 0),
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
        .leftJoin("entity_media_links as eml", function () {
          this.on("eml.entity_id", "=", "drops.id")
            .andOn("eml.entity_type", "=", db.raw("'drop'"))
            .andOn("eml.role", "=", db.raw("'cover'"));
        })
        .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
        .select(
          "drops.id",
          "drops.handle",
          "drops.title",
          "drops.description",
          "ma.public_url as hero_image_url",
          "drops.starts_at",
          "drops.ends_at",
          "drops.artist_id",
          "drops.label_id",
          "drops.status",
          "drops.created_by_user_id",
          "drops.created_at",
          "drops.updated_at"
        )
        .orderBy("drops.updated_at", "desc")
        .limit(200);
      const coverMap = await loadCoverUrlMap(
        "drop",
        rows.map((row) => row.id)
      );
      return res.json({
        items: rows.map((row) => formatDrop(row, coverMap.get(row.id))),
      });
    }

    const db = getDb();
    const rows = await db("drops")
      .leftJoin("entity_media_links as eml", function () {
        this.on("eml.entity_id", "=", "drops.id")
          .andOn("eml.entity_type", "=", db.raw("'drop'"))
          .andOn("eml.role", "=", db.raw("'cover'"));
      })
      .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
      .select(
        "drops.id",
        "drops.handle",
        "drops.title",
        "drops.description",
        "ma.public_url as hero_image_url",
        "drops.starts_at",
        "drops.ends_at",
        "drops.artist_id",
        "drops.label_id",
        "drops.status",
        "drops.created_by_user_id",
        "drops.created_at",
        "drops.updated_at"
      )
      .where({ "drops.status": "published" })
      .orderBy("drops.updated_at", "desc")
      .limit(50);
    const coverMap = await loadCoverUrlMap(
      "drop",
      rows.map((row) => row.id)
    );
    return res.json({
      items: rows.map((row) => formatDrop(row, coverMap.get(row.id))),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/featured", async (req, res, next) => {
  try {
    const db = getDb();
    const rows = await db("drops")
      .leftJoin("entity_media_links as eml", function () {
        this.on("eml.entity_id", "=", "drops.id")
          .andOn("eml.entity_type", "=", db.raw("'drop'"))
          .andOn("eml.role", "=", db.raw("'cover'"));
      })
      .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
      .select(
        "drops.id",
        "drops.handle",
        "drops.title",
        "drops.description",
        "ma.public_url as hero_image_url",
        "drops.starts_at",
        "drops.ends_at",
        "drops.artist_id",
        "drops.label_id",
        "drops.status",
        "drops.created_by_user_id",
        "drops.created_at",
        "drops.updated_at"
      )
      .where({ "drops.status": "published" })
      .orderBy("drops.updated_at", "desc")
      .limit(12);
    const coverMap = await loadCoverUrlMap(
      "drop",
      rows.map((row) => row.id)
    );
    res.json({
      items: rows.map((row) => formatDrop(row, coverMap.get(row.id))),
    });
  } catch (err) {
    next(err);
  }
});
};

module.exports = { registerDropsListingRoutes };
