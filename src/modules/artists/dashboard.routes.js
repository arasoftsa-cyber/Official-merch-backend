const express = require("express");
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const {
  getArtistDashboardSummary,
  getArtistDashboardOrders,
  getArtistDashboardOrderDetail,
} = require("./dashboard.service");
const { getDb } = require("../../config/db");

const router = express.Router();

const FORBIDDEN = { error: "forbidden" };

const ensureArtist = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (userRole !== "artist" || !userId) {
      return res.status(403).json(FORBIDDEN);
    }
    const db = getDb();
    const link = await db("artist_user_map").where({ user_id: userId }).first();
    if (!link) {
      return res.status(403).json(FORBIDDEN);
    }
    return next();
  } catch (err) {
    console.error("[ensureArtist]", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
};

const handleSummary = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(403).json(FORBIDDEN);
    }
    const summary = await getArtistDashboardSummary(user.id);
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

router.get(
  "/",
  requireAuth,
  ensureArtist,
  requirePolicy("artist_dashboard:read", "self"),
  handleSummary
);

router.get(
  "/summary",
  requireAuth,
  ensureArtist,
  requirePolicy("artist_dashboard:read", "self"),
  handleSummary
);

router.get(
  "/orders",
  requireAuth,
  ensureArtist,
  requirePolicy("artist_dashboard:read", "self"),
  async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(403).json(FORBIDDEN);
      }
      const items = await getArtistDashboardOrders(user.id);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/orders/:orderId",
  requireAuth,
  ensureArtist,
  requirePolicy("artist_dashboard:read", "self"),
  async (req, res, next) => {
    try {
      const user = req.user;
      const orderId = req.params.orderId;
      if (!user || !orderId) {
        return res.status(403).json(FORBIDDEN);
      }
      const detail = await getArtistDashboardOrderDetail(user.id, orderId);
      if (!detail) {
        return res.status(403).json(FORBIDDEN);
      }
      return res.json(detail);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
