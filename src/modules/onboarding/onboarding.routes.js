const express = require("express");
const router = express.Router();

const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const {
  linkArtistUser,
  linkLabelArtist,
  unlinkLabelArtist,
  createArtist,
  createLabel,
} = require("./onboarding.controller");

const ADMIN_POLICY = requirePolicy("admin:ownership:write", "system");
const DOMAIN_POLICY = requirePolicy("admin:domain:write", "system");

router.post(
  "/link-artist-user",
  requireAuth,
  ADMIN_POLICY,
  express.json(),
  linkArtistUser
);

router.post(
  "/link-label-artist",
  requireAuth,
  ADMIN_POLICY,
  express.json(),
  linkLabelArtist
);

router.delete(
  "/unlink-label-artist",
  requireAuth,
  ADMIN_POLICY,
  express.json(),
  unlinkLabelArtist
);

router.post(
  "/create-artist",
  requireAuth,
  DOMAIN_POLICY,
  express.json(),
  createArtist
);

router.post(
  "/create-label",
  requireAuth,
  DOMAIN_POLICY,
  express.json(),
  createLabel
);

module.exports = router;
