const express = require("express");
const { getDb } = require("../../config/db");
const { requireAuth } = require("../../middleware/auth.middleware");

const router = express.Router();

const BAD_REQUEST = { error: "bad_request" };

const ensureAdminAccess = async (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
};

const formatVariant = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    size: row.size,
    color: row.color,
    priceCents: row.price_cents,
    stock: row.stock,
  };
};

const validateVariant = (variant) => {
  if (!variant) return "variant_missing";
  if (!variant.sku || !variant.sku.trim()) return "invalid_sku";
  if (!variant.size || !variant.size.trim()) return "invalid_size";
  if (!variant.color || !variant.color.trim()) return "invalid_color";
  const price = Number(variant.priceCents);
  if (!Number.isFinite(price) || price <= 0) return "invalid_price";
  const stock = Number(variant.stock);
  if (!Number.isInteger(stock) || stock < 0) return "invalid_stock";
  return null;
};

router.get(
  ["/products/:id/variants", "/admin/products/:id/variants"],
  requireAuth,
  ensureAdminAccess,
  async (req, res, next) => {
    try {
      const db = getDb();
      const product = await db("products")
        .where({ id: req.params.id })
        .first();
      if (!product) {
        return res.status(404).json({ error: "product_not_found" });
      }
      const rows = await db("product_variants")
        .where({ product_id: req.params.id })
        .orderBy("created_at", "asc");
      return res.json({
        productId: product.id,
        variants: rows.map(formatVariant),
      });
    } catch (err) {
      next(err);
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
      const product = await db("products")
        .where({ id: req.params.id })
        .first();
      if (!product) {
        return res.status(404).json({ error: "product_not_found" });
      }
      const normalized = [];
      const toUpdate = [];
      const toInsert = [];
      payload.variants.forEach((variant) => {
        const error = validateVariant(variant);
        if (error) {
          throw { error };
        }
        const normalizedVariant = {
          id: variant.id,
          sku: variant.sku.trim(),
          size: variant.size.trim(),
          color: variant.color.trim(),
          price_cents: Number(variant.priceCents),
          stock: Number(variant.stock),
        };
        normalized.push(normalizedVariant);
        if (variant.id) {
          toUpdate.push(normalizedVariant);
        } else {
          toInsert.push(normalizedVariant);
        }
      });
      await db.transaction(async (trx) => {
        const existing = await trx("product_variants")
          .select("id")
          .where({ product_id: req.params.id });
        const incomingIds = new Set(
          normalized.filter((v) => v.id).map((v) => v.id)
        );
        await trx("product_variants")
          .where({ product_id: req.params.id })
          .whereNotIn(
            "id",
            Array.from(incomingIds).filter(Boolean)
          )
          .del();
        for (const variant of toUpdate) {
          await trx("product_variants")
            .where({ id: variant.id, product_id: req.params.id })
            .update({
              sku: variant.sku,
              size: variant.size,
              color: variant.color,
              price_cents: variant.price_cents,
              stock: variant.stock,
            });
        }
        for (const variant of toInsert) {
          await trx("product_variants").insert({
            product_id: req.params.id,
            sku: variant.sku,
            size: variant.size,
            color: variant.color,
            price_cents: variant.price_cents,
            stock: variant.stock,
            created_at: trx.fn.now(),
          });
        }
      });
      const rows = await db("product_variants")
        .where({ product_id: req.params.id })
        .orderBy("created_at", "asc");
      return res.json({
        productId: req.params.id,
        variants: rows.map(formatVariant),
      });
    } catch (err) {
      if (err?.error) {
        return res.status(400).json({ error: err.error });
      }
      next(err);
    }
  }
);

router.delete(
  ["/product-variants/:variantId", "/admin/product-variants/:variantId"],
  requireAuth,
  ensureAdminAccess,
  async (req, res, next) => {
    try {
      const db = getDb();
      const variant = await db("product_variants")
        .where({ id: req.params.variantId })
        .first();
      if (!variant) {
        return res.status(404).json({ error: "variant_not_found" });
      }
      await db("product_variants")
        .where({ id: req.params.variantId })
        .del();
      return res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
