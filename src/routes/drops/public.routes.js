const registerDropsPublicRoutes = (router, deps) => {
  const {
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
  } = deps;

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
    const coverMap = await loadCoverUrlMap("drop", [drop.id]);
    res.json({ drop: formatDrop(drop, coverMap.get(drop.id)) });
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
    const coverMap = await loadCoverUrlMap("drop", [drop.id]);
    res.json({ drop: formatDrop(drop, coverMap.get(drop.id)) });
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
    const productColumns = await db("products").columnInfo();
    const hasStatus = Object.prototype.hasOwnProperty.call(productColumns, "status");
    const hasIsActive = Object.prototype.hasOwnProperty.call(productColumns, "is_active");
    const productsQuery = db("drop_products as dp")
      .join("products as p", "dp.product_id", "p.id")
      .select(
        "p.id",
        "p.title",
        "p.artist_id",
        "p.is_active",
        buildSellableMinPriceSubquery(db, { productRef: "p.id" }).wrap("(", ") as price_cents")
      )
      .where("dp.drop_id", drop.id);
    applyPublicActiveProductFilter(productsQuery, {
      productRef: "p",
      hasStatus,
      hasIsActive,
    });
    applySellableVariantExists(productsQuery, { productRef: "p.id" });
    applyDropProductOrdering(productsQuery);
    const rows = await productsQuery;
    res.json({ items: rows.map(formatProduct) });
  } catch (err) {
    next(err);
  }
});
};

module.exports = { registerDropsPublicRoutes };
