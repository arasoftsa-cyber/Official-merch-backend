const express = require("express");
const { getDb } = require("../core/db/db");
const { requireAuth } = require("../core/http/auth.middleware");
const {
  ensureAdminAccess,
  putProductVariantsWorkflow,
  putVariantErrorResponse,
  getProductVariantsResponse,
  deleteVariantResponse,
  listInventorySkusResponse,
  createInventorySkuResponse,
  bulkDeactivateInventorySkusResponse,
  patchInventorySkuResponse,
} = require("./productVariants.service");
const {
  asUuidOrNull,
  normalizeVariant,
  validateListedVariantPrice,
  validateUniqueInventorySkuMappings,
} = require("./productVariants.validators");
const { orderVariantsByTouchedIds } = require("./productVariants.repository");

const router = express.Router();

router.get(
  ["/products/:id/variants", "/admin/products/:id/variants"],
  requireAuth,
  ensureAdminAccess,
  async (req, res, next) => {
    try {
      const result = await getProductVariantsResponse({ db: getDb(), productId: req.params.id });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      return next(err);
    }
  }
);

router.put(
  ["/products/:id/variants", "/admin/products/:id/variants"],
  requireAuth,
  ensureAdminAccess,
  express.json(),
  async (req, res, next) => {
    try {
      const payload = req.body;
      if (!payload || !Array.isArray(payload.variants)) {
        return res.status(400).json({ error: "missing_variants" });
      }
      const db = getDb();
      const productResult = await getProductVariantsResponse({ db, productId: req.params.id });
      if (productResult.statusCode === 404) {
        return res.status(404).json(productResult.body);
      }

      const result = await putProductVariantsWorkflow({
        db,
        productId: req.params.id,
        variantsPayload: payload.variants,
      });
      if (result?.error && result?.statusCode) {
        return res.status(result.statusCode).json({ error: result.error });
      }
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      const mapped = putVariantErrorResponse(err);
      if (mapped) {
        return res.status(mapped.statusCode).json(mapped.body);
      }
      return next(err);
    }
  }
);

router.delete(
  ["/product-variants/:variantId", "/admin/product-variants/:variantId"],
  requireAuth,
  ensureAdminAccess,
  async (req, res, next) => {
    try {
      const result = await deleteVariantResponse({ db: getDb(), variantId: req.params.variantId });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  ["/inventory-skus", "/admin/inventory-skus"],
  requireAuth,
  ensureAdminAccess,
  async (req, res, next) => {
    try {
      const result = await listInventorySkusResponse({ db: getDb(), query: req.query });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  ["/inventory-skus", "/admin/inventory-skus"],
  requireAuth,
  ensureAdminAccess,
  express.json(),
  async (req, res, next) => {
    try {
      const result = await createInventorySkuResponse({ db: getDb(), payload: req.body || {} });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      if (err?.code === "23505") {
        return res.status(409).json({ error: "supplier_sku_conflict" });
      }
      return next(err);
    }
  }
);

router.post(
  ["/inventory-skus/bulk-deactivate", "/admin/inventory-skus/bulk-deactivate"],
  requireAuth,
  ensureAdminAccess,
  express.json(),
  async (req, res, next) => {
    try {
      const result = await bulkDeactivateInventorySkusResponse({
        db: getDb(),
        payload: req.body || {},
      });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      return next(err);
    }
  }
);

router.patch(
  ["/inventory-skus/:id", "/admin/inventory-skus/:id"],
  requireAuth,
  ensureAdminAccess,
  express.json(),
  async (req, res, next) => {
    try {
      const skuId = asUuidOrNull(req.params.id);
      if (!skuId) {
        return res.status(400).json({ error: "invalid_inventory_sku_id" });
      }
      const result = await patchInventorySkuResponse({
        db: getDb(),
        skuId,
        payload: req.body || {},
      });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      if (err?.code === "23505") {
        return res.status(409).json({ error: "supplier_sku_conflict" });
      }
      return next(err);
    }
  }
);

module.exports = router;
module.exports.__test = {
  normalizeVariant,
  orderVariantsByTouchedIds,
  validateListedVariantPrice,
  validateUniqueInventorySkuMappings,
};
