const express = require("express");
const { getDb } = require("../core/db/db");
const { requireAuth } = require("../core/http/auth.middleware");
const { requirePolicy } = require("../core/http/policy.middleware");
const {
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
const {
  normalizePutProductVariantsPayload,
  validatePutProductVariantsPayload,
  normalizeInventorySkuCreatePayload,
  validateInventorySkuCreatePayload,
  normalizeBulkDeactivateInventorySkusPayload,
  validateBulkDeactivateInventorySkusPayload,
  normalizePatchInventorySkuPayload,
  validatePatchInventorySkuPayload,
} = require("../contracts/productVariants.contract");
const { logLegacyContractUse } = require("../contracts/shared");

const router = express.Router();
const requireAdminProductVariantsRead = requirePolicy("admin_dashboard:read", "product_variants");
const requireAdminProductVariantsWrite = requirePolicy("admin_dashboard:write", "product_variants");
const requireAdminInventorySkusRead = requirePolicy("admin_dashboard:read", "inventory_skus");
const requireAdminInventorySkusWrite = requirePolicy("admin_dashboard:write", "inventory_skus");

router.get(
  ["/products/:id/variants", "/admin/products/:id/variants"],
  requireAuth,
  requireAdminProductVariantsRead,
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
  requireAdminProductVariantsWrite,
  express.json(),
  async (req, res, next) => {
    try {
      const normalized = normalizePutProductVariantsPayload(req.body || {});
      const payload = validatePutProductVariantsPayload(normalized.dto);
      logLegacyContractUse({
        workflow: "product_variants.put",
        legacyKeys: normalized.meta.legacyKeys,
      });
      if (!Array.isArray(payload.variants)) {
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
      if (err?.code === "validation_error") {
        return res.status(400).json({ error: err.message || "missing_variants" });
      }
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
  requireAdminProductVariantsWrite,
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
  requireAdminInventorySkusRead,
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
  requireAdminInventorySkusWrite,
  express.json(),
  async (req, res, next) => {
    try {
      const normalized = normalizeInventorySkuCreatePayload(req.body || {});
      const payload = validateInventorySkuCreatePayload(normalized.dto);
      logLegacyContractUse({
        workflow: "inventory_skus.create",
        legacyKeys: normalized.meta.legacyKeys,
      });
      const result = await createInventorySkuResponse({ db: getDb(), payload });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      if (err?.code === "validation_error") {
        return res.status(400).json({ error: err.message || "validation_error" });
      }
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
  requireAdminInventorySkusWrite,
  express.json(),
  async (req, res, next) => {
    try {
      const normalized = normalizeBulkDeactivateInventorySkusPayload(req.body || {});
      const payload = validateBulkDeactivateInventorySkusPayload(normalized.dto);
      logLegacyContractUse({
        workflow: "inventory_skus.bulk_deactivate",
        legacyKeys: normalized.meta.legacyKeys,
      });
      const result = await bulkDeactivateInventorySkusResponse({
        db: getDb(),
        payload,
      });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      if (err?.code === "validation_error") {
        return res.status(400).json({ error: err.message || "validation_error" });
      }
      return next(err);
    }
  }
);

router.patch(
  ["/inventory-skus/:id", "/admin/inventory-skus/:id"],
  requireAuth,
  requireAdminInventorySkusWrite,
  express.json(),
  async (req, res, next) => {
    try {
      const skuId = asUuidOrNull(req.params.id);
      if (!skuId) {
        return res.status(400).json({ error: "invalid_inventory_sku_id" });
      }
      const normalized = normalizePatchInventorySkuPayload(req.body || {});
      const payload = validatePatchInventorySkuPayload(normalized.dto);
      logLegacyContractUse({
        workflow: "inventory_skus.patch",
        legacyKeys: normalized.meta.legacyKeys,
      });
      const result = await patchInventorySkuResponse({
        db: getDb(),
        skuId,
        payload,
      });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      if (err?.code === "validation_error") {
        return res.status(400).json({ error: err.message || "validation_error" });
      }
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
