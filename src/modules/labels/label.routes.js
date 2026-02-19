const express = require("express");
const router = express.Router();
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const { getDb } = require("../../config/db");
const { doesUserOwnLabel } = require("../../utils/ownership");

const ctxBuilder = async (req) => {
  const db = getDb();
  return {
    db,
    labelId: req.params.labelId,
    artistId: req.params.artistId,
    userId: req.user?.id,
  };
};

const ensureLabelOwnsLabelId = async (req, res, next) => {
  const ownsLabel = await doesUserOwnLabel(
    getDb(),
    req.user?.id,
    req.params.labelId
  );

  if (!ownsLabel) {
    return res.sendStatus(403);
  }

  next();
};

router.get(
  "/:labelId/artists/:artistId/sales-probe",
  requireAuth,
  ensureLabelOwnsLabelId,
  requirePolicy("label:sales:read", "linked", ctxBuilder),
  (req, res) => {
    res.json({
      ok: true,
      labelId: req.params.labelId,
      artistId: req.params.artistId,
    });
  }
);

module.exports = router;
