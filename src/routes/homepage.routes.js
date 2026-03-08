const express = require("express");
const { getHomepageBanners } = require("../controllers/homepage.controller");

const router = express.Router();

router.get("/banners", getHomepageBanners);

module.exports = router;
