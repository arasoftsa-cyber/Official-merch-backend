const express = require("express");
const { getHomepageBanners } = require("./homepage.controller");

const router = express.Router();

router.get("/banners", getHomepageBanners);

module.exports = router;
