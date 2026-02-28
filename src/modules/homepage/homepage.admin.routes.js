const express = require("express");
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const {
  getHomepageBanners,
  createHomepageBannerHandler,
  patchHomepageBannerHandler,
  deleteHomepageBannerHandler,
  uploadHomepageBannerHandler,
} = require("./homepage.controller");

const router = express.Router();
const requireAdminRead = requirePolicy("admin_dashboard:read", "homepage_banners");
const requireAdminWrite = requirePolicy("admin_dashboard:write", "homepage_banners");

router.get("/banners", requireAuth, requireAdminRead, getHomepageBanners);
router.post(
  "/banners",
  requireAuth,
  requireAdminWrite,
  express.json(),
  createHomepageBannerHandler
);
router.post(
  "/banners/upload",
  requireAuth,
  requireAdminWrite,
  uploadHomepageBannerHandler
);
router.patch(
  "/banners/:linkId",
  requireAuth,
  requireAdminWrite,
  express.json(),
  patchHomepageBannerHandler
);
router.delete(
  "/banners/:linkId",
  requireAuth,
  requireAdminWrite,
  deleteHomepageBannerHandler
);

module.exports = router;
