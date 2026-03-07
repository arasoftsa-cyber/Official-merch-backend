const express = require("express");
const router = express.Router();
const { getArtist, getShelf, getArtists, getFeaturedArtists } = require("./artist.controller");

router.get("/featured", getFeaturedArtists);
router.get("/", getArtists);
router.get("/:handle", getArtist);
router.get("/:handle/shelf", getShelf);
router.get("/:handle/products", getShelf);

module.exports = router;
