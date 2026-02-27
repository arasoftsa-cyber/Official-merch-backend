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

const parseNonNegativeInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue) || numberValue < 0) {
    return null;
  }
  return numberValue;
};

const normalizeVariant = (variant) => {
  if (!variant || typeof variant !== "object") {
    return { error: "variant_missing" };
  }

  const sku = String(variant.sku || "").trim();
  if (!sku) return { error: "invalid_sku" };

  const price = parseNonNegativeInt(variant.priceCents ?? variant.price_cents);
  if (price === null) return { error: "invalid_price" };

  const stock = parseNonNegativeInt(variant.stock);
  if (stock === null) return { error: "invalid_stock" };

  const idValue = String(variant.id || "").trim();
  const size = String(variant.size || "").trim() || "default";
  const color = String(variant.color || "").trim() || "default";

  return {
    value: {
      id: idValue || null,
      sku,
      size,
      color,
      price_cents: price,
      stock,
    },
  };
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
      const variants = rows.map(formatVariant);
      return res.json({
        productId: product.id,
        variants,
        items: variants,
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
      payload.variants.forEach((variant) => {
        const normalizedRow = normalizeVariant(variant);
        if (normalizedRow.error) {
          throw { error: normalizedRow.error };
        }
        normalized.push(normalizedRow.value);
      });

      await db.transaction(async (trx) => {
        const existing = await trx("product_variants")
          .select("id", "sku")
          .where({ product_id: req.params.id });
        const byId = new Map(existing.map((row) => [row.id, row]));
        const bySku = new Map(existing.map((row) => [row.sku, row]));
        const keepVariantIds = new Set();

        for (const variant of normalized) {
          const updatePayload = {
            sku: variant.sku,
            size: variant.size,
            color: variant.color,
            price_cents: variant.price_cents,
            stock: variant.stock,
          };

          if (variant.id && byId.has(variant.id)) {
            await trx("product_variants")
              .where({ id: variant.id, product_id: req.params.id })
              .update(updatePayload);
            keepVariantIds.add(variant.id);
            continue;
          }

          const rowBySku = bySku.get(variant.sku);
          if (rowBySku?.id) {
            await trx("product_variants")
              .where({ id: rowBySku.id, product_id: req.params.id })
              .update(updatePayload);
            keepVariantIds.add(rowBySku.id);
            continue;
          }

          const [inserted] = await trx("product_variants")
            .insert({
              product_id: req.params.id,
              sku: variant.sku,
              size: variant.size,
              color: variant.color,
              price_cents: variant.price_cents,
              stock: variant.stock,
              created_at: trx.fn.now(),
            })
            .returning(["id"]);
          const insertedId = inserted?.id;
          if (insertedId) {
            keepVariantIds.add(insertedId);
            bySku.set(variant.sku, { id: insertedId, sku: variant.sku });
          }
        }

        if (normalized.length === 0) {
          await trx("product_variants").where({ product_id: req.params.id }).del();
        } else {
          await trx("product_variants")
            .where({ product_id: req.params.id })
            .whereNotIn("id", Array.from(keepVariantIds))
            .del();
        }
      });
      const rows = await db("product_variants")
        .where({ product_id: req.params.id })
        .orderBy("created_at", "asc");
      const variants = rows.map(formatVariant);
      return res.json({
        productId: req.params.id,
        variants,
        items: variants,
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
