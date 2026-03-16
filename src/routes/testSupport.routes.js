const express = require("express");
const { seedUiSmoke } = require("../../scripts/seed_ui_smoke");
const { createProductWithVariants } = require("../services/catalog.service");

const router = express.Router();

const NODE_ENV = String(process.env.NODE_ENV || "").trim().toLowerCase();
const TEST_SUPPORT_ENABLED =
  NODE_ENV === "test" ||
  String(process.env.ENABLE_PLAYWRIGHT_TEST_SUPPORT || "").trim().toLowerCase() === "true";
const TEST_SUPPORT_KEY = String(process.env.PLAYWRIGHT_TEST_SUPPORT_KEY || "om-playwright-local").trim();

const requireTestSupport = (req, res, next) => {
  if (!TEST_SUPPORT_ENABLED) {
    return res.status(404).json({ error: "not_found" });
  }
  const providedKey = String(req.get("x-playwright-test-support-key") || "").trim();
  if (!providedKey || providedKey !== TEST_SUPPORT_KEY) {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
};

router.use(express.json());
router.use(requireTestSupport);

router.post("/playwright/bootstrap", async (_req, res, next) => {
  try {
    const seeded = await seedUiSmoke({ env: process.env });
    return res.status(200).json({
      items: {
        adminUser: seeded.adminUser,
        buyerUser: seeded.buyerUser,
        artistUser: seeded.artistUser,
        labelUser: seeded.labelUser,
        artist: {
          ...seeded.artist,
          artistHandle: seeded.artist?.handle || null,
        },
        label: {
          ...seeded.label,
          labelHandle: seeded.label?.handle || null,
        },
        product: seeded.product,
        variant: seeded.variant,
        drop: seeded.drop,
        order: seeded.order,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/playwright/products", async (req, res, next) => {
  try {
    const seeded = await seedUiSmoke({ env: process.env });
    const body = req.body || {};
    const status = String(body.status || "active").trim().toLowerCase();
    const title = String(body.title || "").trim();
    if (!title) {
      return res.status(400).json({ error: "title_required" });
    }
    if (!["pending", "inactive", "active", "rejected"].includes(status)) {
      return res.status(400).json({ error: "invalid_status" });
    }

    const productId = await createProductWithVariants({
      artistId: String(body.artistId || seeded.artist?.id || "").trim(),
      title,
      description: String(body.description || `Playwright seeded product ${title}`).trim(),
      status,
      variants: [
        {
          sku: String(body.sku || `PW-${status}-${Date.now()}`).trim(),
          size: String(body.size || "M").trim(),
          color: String(body.color || "Black").trim(),
          priceCents: Number(body.priceCents || 1999),
          stock: Number(body.stock || 10),
          merchType: String(body.merchType || "regular_tshirt").trim(),
        },
      ],
    });

    return res.status(201).json({
      items: {
        productId,
        artistId: String(body.artistId || seeded.artist?.id || "").trim(),
        artistHandle: String(seeded.artist?.handle || "").trim(),
        status,
        title,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
