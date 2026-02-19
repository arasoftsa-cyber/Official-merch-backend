const express = require("express");
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const { getDb } = require("../../config/db");

const FORBIDDEN = { error: "forbidden" };
const router = express.Router();
const isDevMode = process.env.NODE_ENV !== "production";
const {
  getLabelDashboardSummary,
  getLabelDashboardOrders,
  getLabelArtistSummary,
  resolveLabelIdForUser,
  createEmptyDashboardPayload,
  clampOrderLimit,
} = require("./dashboard.service");
const { isLabelLinkedToArtist } = require("../../utils/ownership");

const ensureLabel = (req, res, next) => {
  if (req.user?.role !== "label") {
    return res.status(403).json(FORBIDDEN);
  }
  return next();
};

const NOT_IMPLEMENTED = { error: "not_implemented" };

const handleSummary = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(403).json(FORBIDDEN);
    }
    const db = getDb();
    const labelId = await resolveLabelIdForUser(db, user.id);
    if (!labelId) {
      return res.json(createEmptyDashboardPayload());
    }
    const summary = await getLabelDashboardSummary(labelId);
    res.json(summary);
  } catch (err) {
    const safeMessage = err?.message ? String(err.message) : "An unexpected error occurred";
    if (isDevMode) {
      return res.status(500).json({
        error: "internal_server_error",
        message: safeMessage,
        where: "label_dashboard",
      });
    }
    return res.status(500).json({ error: "internal_server_error" });
  }
};

router.get(
  "/",
  requireAuth,
  ensureLabel,
  requirePolicy("label_dashboard:read", "self"),
  handleSummary
);

router.get(
  "/summary",
  requireAuth,
  ensureLabel,
  requirePolicy("label_dashboard:read", "self"),
  handleSummary
);

router.get(
  "/orders",
  requireAuth,
  ensureLabel,
  requirePolicy("label_dashboard:read", "self"),
  async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(403).json(FORBIDDEN);
      }
      const db = getDb();
      const status = req.query.status;
      const range = req.query.range;
      const limitParam = req.query.limit;
      const limit = clampOrderLimit(limitParam);
      const filters = { status, range, limit: limitParam };
      const labelId = await resolveLabelIdForUser(db, user.id);
      if (!labelId) {
        return res.json({ orders: [], meta: { status, range, limit } });
      }
      console.log("### HIT label dashboard orders handler ###", {
        time: new Date().toISOString(),
      });
      const artistIds = await db("label_artist_map")
        .where({ label_id: labelId })
        .pluck("artist_id");
      console.log("### LABEL ORDERS CONTEXT ###", {
        labelId,
        artistIdsCount: artistIds.length,
      });
      const data = await getLabelDashboardOrders(labelId, filters);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

const handleArtistSummary = async (req, res, next) => {
  try {
    const user = req.user;
    const artistId = req.params.artistId;
    if (!user || !artistId) {
      return res.status(403).json(FORBIDDEN);
    }

    const db = getDb();
    const labelId = await resolveLabelIdForUser(db, user.id);
    if (!labelId) {
      return res.status(403).json(FORBIDDEN);
    }

    const isLinked = await isLabelLinkedToArtist(db, labelId, artistId);
    if (!isLinked) {
      return res.status(403).json(FORBIDDEN);
    }

    const payload = await getLabelArtistSummary(labelId, artistId);
    if (!payload) {
      return res.status(403).json(FORBIDDEN);
    }

    return res.json(payload);
  } catch (err) {
    return next(err);
  }
};

router.get(
  "/artists/:artistId",
  requireAuth,
  ensureLabel,
  requirePolicy("label_dashboard:read", "self"),
  handleArtistSummary
);

router.get(
  "/artists/:artistId/summary",
  requireAuth,
  ensureLabel,
  requirePolicy("label_dashboard:read", "self"),
  handleArtistSummary
);

module.exports = router;
