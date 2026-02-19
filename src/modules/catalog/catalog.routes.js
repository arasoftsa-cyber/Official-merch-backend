const express = require("express");
const router = express.Router();
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const {
  listProducts,
  listArtistProducts,
  getProduct,
  createProduct,
  updateProduct,
} = require("./catalog.controller");

const { getDb } = require("../../config/db");

const catalogPolicyCtx = async (req) => {
  const db = getDb();
  let artistId = req.body?.artistId;
  const productId = req.params?.id || req.params?.productId;
  if (!artistId && productId) {
    const product = await db("products").select("artist_id").where({ id: productId }).first();
    artistId = product?.artist_id;
  }
  const userId = req.user?.id;
  const userRole = req.user?.role;
  if (!artistId && userRole === "artist" && userId) {
    const mapping = await db("artist_user_map").select("artist_id").where({ user_id: userId }).first();
    artistId = mapping?.artist_id;
  }
  return {
    db,
    artistId,
    userId,
    userRole,
  };
};

const rejectLabelMutations = (req, res, next) => {
  if (req.user?.role === "label") {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
};

const rejectBuyerMutations = (req, res, next) => {
  if (req.user?.role === "buyer") {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
};

const allowAdminOrArtist = (req, res, next) => {
  const role = req.user?.role;
  if (role !== "admin" && role !== "artist") {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
};

const normalizeStatusPatch = (req, res, next) => {
  const body = req.body || {};
  if (typeof body.active === "boolean" && typeof body.isActive === "undefined") {
    req.body = { ...body, isActive: body.active };
  }
  next();
};

router.get("/products", listProducts);
router.get("/artist/products", requireAuth, listArtistProducts);
router.get("/products/:id", getProduct);
router.get("/admin/products", requireAuth, requireAdmin, listProducts);

router.post(
  "/products",
  requireAuth,
  requireAdmin,
  rejectLabelMutations,
  rejectBuyerMutations,
  requirePolicy("catalog:product:create", "self", catalogPolicyCtx),
  express.json(),
  createProduct
);
router.post(
  "/admin/products",
  requireAuth,
  requireAdmin,
  rejectLabelMutations,
  rejectBuyerMutations,
  requirePolicy("catalog:product:create", "self", catalogPolicyCtx),
  express.json(),
  createProduct
);

router.patch(
  "/products/:id",
  requireAuth,
  allowAdminOrArtist,
  rejectLabelMutations,
  requirePolicy("catalog:product:update", "self", catalogPolicyCtx),
  express.json(),
  updateProduct
);
router.patch(
  "/products/:id/status",
  requireAuth,
  allowAdminOrArtist,
  rejectLabelMutations,
  requirePolicy("catalog:product:update", "self", catalogPolicyCtx),
  express.json(),
  normalizeStatusPatch,
  updateProduct
);
router.patch(
  "/admin/products/:id",
  requireAuth,
  requireAdmin,
  rejectLabelMutations,
  requirePolicy("catalog:product:update", "self", catalogPolicyCtx),
  express.json(),
  updateProduct
);

module.exports = router;
