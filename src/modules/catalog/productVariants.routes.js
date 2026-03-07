const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../../core/db/db");
const { requireAuth } = require("../../core/http/auth.middleware");
const {
  buildVariantInventoryQuery,
  formatVariantInventoryRow,
} = require("./variantAvailability");
const { resolveOurShareCents } = require("./economics");

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ensureAdminAccess = async (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
};

const asUuidOrNull = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return UUID_RE.test(normalized) ? normalized : null;
};

const parseNonNegativeInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue) || numberValue < 0) {
    return null;
  }
  return numberValue;
};

const parseInteger = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue)) return null;
  return numberValue;
};

const parseBooleanMaybe = (value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return null;
};

const parseNullableText = (value, { maxLength = 120 } = {}) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
};

const throwWithCode = (code) => {
  const err = new Error(code.toLowerCase());
  err.code = code;
  throw err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const validateListedVariantPrice = ({ isListed, sellingPriceCents }) => {
  if (!isListed) return true;
  return Number.isInteger(sellingPriceCents) && sellingPriceCents > 0;
};

const normalizeVariant = (variant) => {
  if (!variant || typeof variant !== "object") {
    return { error: "variant_missing" };
  }

  const idValue = String(variant.id || "").trim();
  if (idValue && !asUuidOrNull(idValue)) {
    return { error: "invalid_variant_id" };
  }

  const hasInventorySkuField =
    hasOwn(variant, "inventorySkuId") || hasOwn(variant, "inventory_sku_id");
  const inventorySkuIdRaw = variant.inventorySkuId ?? variant.inventory_sku_id;
  const inventorySkuId = hasInventorySkuField ? asUuidOrNull(inventorySkuIdRaw) : undefined;
  if (hasInventorySkuField && !inventorySkuId) return { error: "invalid_inventory_sku_id" };

  const size = String(variant.size || "").trim() || "default";
  const color = String(variant.color || "").trim() || "default";
  const sku = String(variant.sku || "").trim() || null;

  let sellingPriceCents = undefined;
  if (
    typeof variant.priceCents !== "undefined" ||
    typeof variant.price_cents !== "undefined" ||
    typeof variant.sellingPriceCents !== "undefined" ||
    typeof variant.selling_price_cents !== "undefined"
  ) {
    sellingPriceCents = parseNonNegativeInt(
      variant.sellingPriceCents ??
        variant.selling_price_cents ??
        variant.priceCents ??
        variant.price_cents
    );
    if (sellingPriceCents === null) return { error: "invalid_price" };
  }

  const isListed = parseBooleanMaybe(variant.isListed ?? variant.is_listed);
  if (isListed === null) return { error: "invalid_is_listed" };

  const stock =
    typeof variant.stock !== "undefined" ? parseNonNegativeInt(variant.stock) : undefined;
  if (stock === null) return { error: "invalid_stock" };

  const vendorPayoutCents =
    typeof variant.vendorPayoutCents !== "undefined" ||
    typeof variant.vendor_payout_cents !== "undefined"
      ? parseNonNegativeInt(variant.vendorPayoutCents ?? variant.vendor_payout_cents)
      : undefined;
  if (vendorPayoutCents === null) return { error: "invalid_vendor_payout_cents" };

  const royaltyCents =
    typeof variant.royaltyCents !== "undefined" ||
    typeof variant.royalty_cents !== "undefined"
      ? parseNonNegativeInt(variant.royaltyCents ?? variant.royalty_cents)
      : undefined;
  if (royaltyCents === null) return { error: "invalid_royalty_cents" };

  const ourShareCents =
    typeof variant.ourShareCents !== "undefined" ||
    typeof variant.our_share_cents !== "undefined"
      ? parseNonNegativeInt(variant.ourShareCents ?? variant.our_share_cents)
      : undefined;
  if (ourShareCents === null) return { error: "invalid_our_share_cents" };

  const shareResolution = resolveOurShareCents({
    sellingPriceCents,
    vendorPayoutCents,
    royaltyCents,
    ourShareCents,
  });
  if (shareResolution.error) return { error: shareResolution.error };
  if (
    typeof ourShareCents === "undefined" &&
    typeof sellingPriceCents === "number" &&
    typeof vendorPayoutCents === "number" &&
    typeof royaltyCents === "number" &&
    typeof shareResolution.ourShareCents !== "number"
  ) {
    return { error: "invalid_our_share_cents" };
  }

  return {
    value: {
      id: idValue || null,
      sku,
      size,
      color,
      inventory_sku_id: inventorySkuId,
      selling_price_cents: sellingPriceCents,
      is_listed: isListed,
      stock,
      vendor_payout_cents: vendorPayoutCents,
      royalty_cents: royaltyCents,
      our_share_cents: shareResolution.ourShareCents,
    },
  };
};

const validateUniqueInventorySkuMappings = (variants = []) => {
  const seen = new Set();
  for (const variant of variants) {
    const key = variant.inventory_sku_id;
    if (!key) continue;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
};

const toInventorySkuPayload = (row) => ({
  id: row.id,
  supplier_sku: row.supplier_sku,
  supplierSku: row.supplier_sku,
  merch_type: row.merch_type,
  merchType: row.merch_type,
  quality_tier: row.quality_tier,
  qualityTier: row.quality_tier,
  size: row.size,
  color: row.color,
  stock: Number(row.stock ?? 0),
  is_active: Boolean(row.is_active),
  isActive: Boolean(row.is_active),
  supplier_cost_cents: row.supplier_cost_cents == null ? null : Number(row.supplier_cost_cents),
  supplierCostCents: row.supplier_cost_cents == null ? null : Number(row.supplier_cost_cents),
  mrp_cents: row.mrp_cents == null ? null : Number(row.mrp_cents),
  mrpCents: row.mrp_cents == null ? null : Number(row.mrp_cents),
  metadata: row.metadata || {},
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const listVariantsForProduct = async (db, productId) => {
  const rows = await buildVariantInventoryQuery(db, { productId }).orderBy("pv.created_at", "asc");
  return rows.map(formatVariantInventoryRow);
};

const orderVariantsByTouchedIds = (variants = [], touchedVariantIds = []) => {
  if (!Array.isArray(variants) || variants.length === 0) return [];
  if (!Array.isArray(touchedVariantIds) || touchedVariantIds.length === 0) {
    return variants.slice();
  }

  const touchedOrder = new Map();
  touchedVariantIds.forEach((id, index) => {
    const key = String(id || "").trim();
    if (key && !touchedOrder.has(key)) {
      touchedOrder.set(key, index);
    }
  });

  return variants
    .map((variant, index) => ({ variant, index }))
    .sort((left, right) => {
      const leftKey = String(left.variant?.id || "").trim();
      const rightKey = String(right.variant?.id || "").trim();
      const leftTouched = touchedOrder.has(leftKey);
      const rightTouched = touchedOrder.has(rightKey);
      if (leftTouched && rightTouched) {
        return touchedOrder.get(leftKey) - touchedOrder.get(rightKey);
      }
      if (leftTouched) return -1;
      if (rightTouched) return 1;
      return left.index - right.index;
    })
    .map((entry) => entry.variant);
};

router.get(
  ["/products/:id/variants", "/admin/products/:id/variants"],
  requireAuth,
  ensureAdminAccess,
  async (req, res, next) => {
    try {
      const db = getDb();
      const product = await db("products").where({ id: req.params.id }).first();
      if (!product) {
        return res.status(404).json({ error: "product_not_found" });
      }
      const variants = await listVariantsForProduct(db, req.params.id);
      return res.json({
        productId: product.id,
        variants,
        items: variants,
      });
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
      const product = await db("products").where({ id: req.params.id }).first();
      if (!product) {
        return res.status(404).json({ error: "product_not_found" });
      }

      const normalized = [];
      for (const variant of payload.variants) {
        const normalizedRow = normalizeVariant(variant);
        if (normalizedRow.error) {
          return res.status(400).json({ error: normalizedRow.error });
        }
        normalized.push(normalizedRow.value);
      }

      if (!validateUniqueInventorySkuMappings(normalized)) {
        return res.status(409).json({ error: "duplicate_inventory_sku_mapping" });
      }

      const created = await db.transaction(async (trx) => {
        const touchedVariantIds = [];
        const [variantColumns, skuColumns] = await Promise.all([
          trx("product_variants").columnInfo(),
          trx("inventory_skus").columnInfo(),
        ]);
        const hasVariantColumn = (name) =>
          Object.prototype.hasOwnProperty.call(variantColumns, name);
        const hasSkuColumn = (name) => Object.prototype.hasOwnProperty.call(skuColumns, name);
        if (!hasVariantColumn("inventory_sku_id")) {
          throwWithCode("INVENTORY_SKU_NOT_CONFIGURED");
        }

        const existingSelection = [
          "id",
          "sku",
          "inventory_sku_id",
          "price_cents",
        ];
        if (hasVariantColumn("is_listed")) {
          existingSelection.push("is_listed");
        }
        if (hasVariantColumn("selling_price_cents")) {
          existingSelection.push("selling_price_cents");
        }
        const existing = await trx("product_variants")
          .select(existingSelection)
          .where({ product_id: req.params.id });
        const byId = new Map(existing.map((row) => [row.id, row]));
        const bySku = new Map(existing.map((row) => [row.sku, row]));
        const mappedSkuByVariantId = new Map(
          existing.map((row) => [row.id, row.inventory_sku_id || null])
        );

        const inventorySkuIds = Array.from(new Set(
          normalized.map((row) => row.inventory_sku_id).filter(Boolean)
        ));
        const skuRows = inventorySkuIds.length
          ? await trx("inventory_skus").select("id", "stock").whereIn("id", inventorySkuIds)
          : [];
        if (inventorySkuIds.length > 0 && skuRows.length !== inventorySkuIds.length) {
          throwWithCode("INVENTORY_SKU_NOT_FOUND");
        }
        const knownInventorySkus = new Map(
          skuRows.map((row) => [row.id, { id: row.id, stock: row.stock }])
        );

        const ensureInventorySkuExists = async (inventorySkuId) => {
          if (!inventorySkuId) {
            throwWithCode("INVENTORY_SKU_NOT_FOUND");
          }
          if (knownInventorySkus.has(inventorySkuId)) return knownInventorySkus.get(inventorySkuId);
          const row = await trx("inventory_skus")
            .select("id", "stock")
            .where({ id: inventorySkuId })
            .first();
          if (!row?.id) {
            throwWithCode("INVENTORY_SKU_NOT_FOUND");
          }
          const normalized = { id: row.id, stock: row.stock };
          knownInventorySkus.set(inventorySkuId, normalized);
          return normalized;
        };

        const createTransitionalInventorySku = async ({ variant, index }) => {
          const compact = (value, fallback) =>
            String(value || fallback)
              .replace(/[^a-z0-9]/gi, "")
              .toUpperCase()
              .slice(0, 12) || fallback;
          const colorSegment = compact(variant.color, "DEFAULT");
          const sizeSegment = compact(variant.size, "DEFAULT");
          const base = `LEGACY-${String(req.params.id).slice(0, 8)}-${colorSegment}-${sizeSegment}`;
          const stockValue = typeof variant.stock === "number" ? variant.stock : 0;

          let attempt = 0;
          while (attempt < 4) {
            const supplierSku =
              attempt === 0 ? base : `${base}-${String(randomUUID()).slice(0, 6).toUpperCase()}`;
            try {
              const payload = {
                id: randomUUID(),
                supplier_sku: supplierSku,
                merch_type: "default",
                quality_tier: null,
                size: variant.size,
                color: variant.color,
                stock: stockValue,
                is_active: true,
                metadata: trx.raw(
                  "?::jsonb",
                  [JSON.stringify({ source: "productVariants.routes.put.legacy", index })]
                ),
                created_at: trx.fn.now(),
                updated_at: trx.fn.now(),
              };
              if (hasSkuColumn("mrp_cents") && typeof variant.selling_price_cents === "number") {
                payload.mrp_cents = variant.selling_price_cents;
              }
              const [inserted] = await trx("inventory_skus")
                .insert(payload)
                .returning(["id"]);
              const createdId = inserted?.id || payload.id;
              knownInventorySkus.set(createdId, {
                id: createdId,
                stock: stockValue,
              });
              return createdId;
            } catch (err) {
              if (err?.code === "23505" || err?.message?.includes("duplicate key")) {
                attempt += 1;
                continue;
              }
              throw err;
            }
          }
          throwWithCode("INVENTORY_SKU_CONFLICT");
        };

        for (let idx = 0; idx < normalized.length; idx += 1) {
          const variant = normalized[idx];
          const existingById = variant.id ? byId.get(variant.id) : null;
          const existingBySku = variant.sku ? bySku.get(variant.sku) : null;
          const existingVariant = existingById || existingBySku || null;
          let resolvedInventorySkuId = variant.inventory_sku_id || null;
          if (!resolvedInventorySkuId && existingVariant?.inventory_sku_id) {
            resolvedInventorySkuId = existingVariant.inventory_sku_id;
          }
          if (!resolvedInventorySkuId) {
            resolvedInventorySkuId = await createTransitionalInventorySku({
              variant,
              index: idx,
            });
          }
          const resolvedInventorySku = await ensureInventorySkuExists(resolvedInventorySkuId);
          const resolvedInventorySkuStock =
            parseNonNegativeInt(resolvedInventorySku?.stock) ?? 0;

          const existingListed =
            !existingVariant || existingVariant.is_listed === null || typeof existingVariant.is_listed === "undefined"
              ? true
              : Boolean(existingVariant.is_listed);
          const nextIsListed =
            typeof variant.is_listed === "boolean" ? variant.is_listed : existingListed;
          const existingSellingPrice = parseNonNegativeInt(
            existingVariant?.selling_price_cents ?? existingVariant?.price_cents
          );
          const nextSellingPrice =
            typeof variant.selling_price_cents === "number"
              ? variant.selling_price_cents
              : existingSellingPrice;
          if (
            !validateListedVariantPrice({
              isListed: nextIsListed,
              sellingPriceCents: nextSellingPrice,
            })
          ) {
            throwWithCode("INVALID_PRICE");
          }

          if (existingVariant) {
            for (const [otherVariantId, mappedSkuId] of mappedSkuByVariantId.entries()) {
              if (otherVariantId === existingVariant.id) continue;
              if (mappedSkuId && mappedSkuId === resolvedInventorySkuId) {
                throwWithCode("DUPLICATE_INVENTORY_SKU_MAPPING");
              }
            }

            const patch = {
              inventory_sku_id: resolvedInventorySkuId,
              size: variant.size,
              color: variant.color,
            };
            if (variant.sku) patch.sku = variant.sku;
            if (typeof variant.selling_price_cents === "number") {
              patch.price_cents = variant.selling_price_cents;
              if (hasVariantColumn("selling_price_cents")) {
                patch.selling_price_cents = variant.selling_price_cents;
              }
            }
            if (typeof variant.is_listed === "boolean" && hasVariantColumn("is_listed")) {
              patch.is_listed = variant.is_listed;
            }
            if (typeof variant.stock === "number" && hasVariantColumn("stock")) {
              // Compatibility mirror only; source of truth is inventory_skus.stock.
              patch.stock = variant.stock;
            } else if (
              hasVariantColumn("stock") &&
              existingVariant?.inventory_sku_id !== resolvedInventorySkuId
            ) {
              // Keep compatibility mirror aligned without clobbering inventory_skus stock.
              patch.stock = resolvedInventorySkuStock;
            }
            if (
              typeof variant.vendor_payout_cents === "number" &&
              hasVariantColumn("vendor_payout_cents")
            ) {
              patch.vendor_payout_cents = variant.vendor_payout_cents;
            }
            if (typeof variant.royalty_cents === "number" && hasVariantColumn("royalty_cents")) {
              patch.royalty_cents = variant.royalty_cents;
            }
            if (
              typeof variant.our_share_cents === "number" &&
              hasVariantColumn("our_share_cents")
            ) {
              patch.our_share_cents = variant.our_share_cents;
            }
            if (hasVariantColumn("updated_at")) {
              patch.updated_at = trx.fn.now();
            }

            await trx("product_variants")
              .where({ id: existingVariant.id, product_id: req.params.id })
              .update(patch);
            if (typeof variant.stock === "number") {
              const stockUpdated = await trx("inventory_skus")
                .where({ id: resolvedInventorySkuId })
                .update({
                  stock: variant.stock,
                  updated_at: trx.fn.now(),
                });
              if (!stockUpdated) {
                throwWithCode("INVENTORY_SKU_NOT_FOUND");
              }
            }
            mappedSkuByVariantId.set(existingVariant.id, resolvedInventorySkuId);
            touchedVariantIds.push(existingVariant.id);
            continue;
          }

          for (const mappedSkuId of mappedSkuByVariantId.values()) {
            if (mappedSkuId && mappedSkuId === resolvedInventorySkuId) {
              throwWithCode("DUPLICATE_INVENTORY_SKU_MAPPING");
            }
          }

          const baseSku = variant.sku || `SKU-${String(req.params.id).slice(0, 8)}-${idx + 1}`;
          let insertedId = null;
          let attempt = 0;
          while (attempt < 4 && !insertedId) {
            const skuCandidate =
              attempt === 0 ? baseSku : `${baseSku}-${String(randomUUID()).slice(0, 6).toUpperCase()}`;
            try {
              const insertPayload = {
                id: randomUUID(),
                product_id: req.params.id,
                inventory_sku_id: resolvedInventorySkuId,
                sku: skuCandidate,
                size: variant.size,
                color: variant.color,
                created_at: trx.fn.now(),
              };
              if (typeof variant.selling_price_cents === "number") {
                insertPayload.price_cents = variant.selling_price_cents;
                if (hasVariantColumn("selling_price_cents")) {
                  insertPayload.selling_price_cents = variant.selling_price_cents;
                }
              } else {
                insertPayload.price_cents = 0;
                if (hasVariantColumn("selling_price_cents")) {
                  insertPayload.selling_price_cents = 0;
                }
              }
              if (hasVariantColumn("is_listed")) {
                insertPayload.is_listed =
                  typeof variant.is_listed === "boolean" ? variant.is_listed : true;
              }
              if (
                typeof variant.vendor_payout_cents === "number" &&
                hasVariantColumn("vendor_payout_cents")
              ) {
                insertPayload.vendor_payout_cents = variant.vendor_payout_cents;
              }
              if (
                typeof variant.royalty_cents === "number" &&
                hasVariantColumn("royalty_cents")
              ) {
                insertPayload.royalty_cents = variant.royalty_cents;
              }
              if (
                typeof variant.our_share_cents === "number" &&
                hasVariantColumn("our_share_cents")
              ) {
                insertPayload.our_share_cents = variant.our_share_cents;
              }
              if (hasVariantColumn("updated_at")) {
                insertPayload.updated_at = trx.fn.now();
              }
              if (hasVariantColumn("stock")) {
                // Compatibility mirror only; source of truth is inventory_skus.stock.
                insertPayload.stock =
                  typeof variant.stock === "number" ? variant.stock : resolvedInventorySkuStock;
              }

              const [inserted] = await trx("product_variants")
                .insert(insertPayload)
                .returning(["id"]);
              insertedId = inserted?.id || null;
              if (insertedId) {
                mappedSkuByVariantId.set(insertedId, resolvedInventorySkuId);
                touchedVariantIds.push(insertedId);
              }
            } catch (err) {
              if (err?.code === "23505" || err?.message?.includes("duplicate key")) {
                attempt += 1;
                continue;
              }
              throw err;
            }
          }

          if (!insertedId) {
            throwWithCode("VARIANT_SKU_CONFLICT");
          }

          if (typeof variant.stock === "number") {
            const stockUpdated = await trx("inventory_skus")
              .where({ id: resolvedInventorySkuId })
              .update({
                stock: variant.stock,
                updated_at: trx.fn.now(),
              });
            if (!stockUpdated) {
              throwWithCode("INVENTORY_SKU_NOT_FOUND");
            }
          }
        }
        return { touchedVariantIds };
      });

      const variants = await listVariantsForProduct(db, req.params.id);
      const orderedVariants = orderVariantsByTouchedIds(
        variants,
        created?.touchedVariantIds || []
      );
      return res.json({
        productId: req.params.id,
        variants: orderedVariants,
        items: orderedVariants,
      });
    } catch (err) {
      if (err?.code === "INVENTORY_SKU_NOT_FOUND") {
        return res.status(400).json({ error: "inventory_sku_not_found" });
      }
      if (err?.code === "INVENTORY_SKU_NOT_CONFIGURED") {
        return res.status(500).json({ error: "inventory_sku_not_configured" });
      }
      if (err?.code === "INVALID_PRICE") {
        return res.status(400).json({ error: "invalid_price" });
      }
      if (err?.code === "DUPLICATE_INVENTORY_SKU_MAPPING" || err?.code === "23505") {
        return res.status(409).json({ error: "duplicate_inventory_sku_mapping" });
      }
      if (err?.code === "VARIANT_SKU_CONFLICT") {
        return res.status(500).json({ error: "variant_sku_conflict" });
      }
      if (err?.code === "INVENTORY_SKU_CONFLICT") {
        return res.status(500).json({ error: "inventory_sku_conflict" });
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
      const db = getDb();
      const variant = await db("product_variants").where({ id: req.params.variantId }).first();
      if (!variant) {
        return res.status(404).json({ error: "variant_not_found" });
      }
      await db("product_variants").where({ id: req.params.variantId }).del();
      return res.json({ ok: true });
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
      const db = getDb();
      const query = db("inventory_skus")
        .select(
          "id",
          "supplier_sku",
          "merch_type",
          "quality_tier",
          "size",
          "color",
          "stock",
          "is_active",
          "supplier_cost_cents",
          "mrp_cents",
          "metadata",
          "created_at",
          "updated_at"
        )
        .orderBy("updated_at", "desc");

      if (typeof req.query.merch_type === "string" && req.query.merch_type.trim()) {
        query.where("merch_type", req.query.merch_type.trim());
      }
      if (typeof req.query.color === "string" && req.query.color.trim()) {
        query.where("color", req.query.color.trim());
      }
      if (typeof req.query.size === "string" && req.query.size.trim()) {
        query.where("size", req.query.size.trim());
      }
      if (typeof req.query.q === "string" && req.query.q.trim()) {
        const q = req.query.q.trim();
        query.andWhere((builder) => {
          builder
            .whereRaw("supplier_sku ilike ?", [`%${q}%`])
            .orWhereRaw("merch_type ilike ?", [`%${q}%`])
            .orWhereRaw("color ilike ?", [`%${q}%`])
            .orWhereRaw("size ilike ?", [`%${q}%`]);
        });
      }

      const isActiveFilter = parseBooleanMaybe(req.query.is_active ?? req.query.isActive);
      if (isActiveFilter !== null && typeof isActiveFilter === "boolean") {
        query.where("is_active", isActiveFilter);
      }

      const inStockFilter = parseBooleanMaybe(req.query.in_stock ?? req.query.inStock);
      if (inStockFilter !== null && typeof inStockFilter === "boolean") {
        if (inStockFilter) {
          query.andWhere("stock", ">", 0);
        } else {
          query.andWhere("stock", "<=", 0);
        }
      }

      const rows = await query;
      return res.json({
        items: rows.map(toInventorySkuPayload),
      });
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
      const db = getDb();
      const payload = req.body || {};

      const supplierSku = parseNullableText(payload.supplierSku ?? payload.supplier_sku, {
        maxLength: 120,
      });
      const merchType = parseNullableText(payload.merchType ?? payload.merch_type, {
        maxLength: 80,
      });
      const qualityTier = parseNullableText(payload.qualityTier ?? payload.quality_tier, {
        maxLength: 80,
      });
      const size = parseNullableText(payload.size, { maxLength: 64 });
      const color = parseNullableText(payload.color, { maxLength: 64 });
      const stock = parseNonNegativeInt(payload.stock);
      const isActiveRaw = parseBooleanMaybe(payload.isActive ?? payload.is_active);
      const hasSupplierCostCents =
        typeof payload.supplierCostCents !== "undefined" ||
        typeof payload.supplier_cost_cents !== "undefined";
      let supplierCostCents = null;
      if (hasSupplierCostCents) {
        const rawSupplierCost = payload.supplierCostCents ?? payload.supplier_cost_cents;
        if (rawSupplierCost !== null && rawSupplierCost !== "") {
          supplierCostCents = parseNonNegativeInt(rawSupplierCost);
          if (supplierCostCents === null) {
            return res.status(400).json({ error: "invalid_supplier_cost_cents" });
          }
        }
      }

      const hasMrpCents =
        typeof payload.mrpCents !== "undefined" || typeof payload.mrp_cents !== "undefined";
      let mrpCents = null;
      if (hasMrpCents) {
        const rawMrp = payload.mrpCents ?? payload.mrp_cents;
        if (rawMrp !== null && rawMrp !== "") {
          mrpCents = parseNonNegativeInt(rawMrp);
          if (mrpCents === null) {
            return res.status(400).json({ error: "invalid_mrp_cents" });
          }
        }
      }

      if (!supplierSku) {
        return res.status(400).json({ error: "supplier_sku_required" });
      }
      if (!merchType) {
        return res.status(400).json({ error: "merch_type_required" });
      }
      if (!size) {
        return res.status(400).json({ error: "size_required" });
      }
      if (!color) {
        return res.status(400).json({ error: "color_required" });
      }
      if (stock === null) {
        return res.status(400).json({ error: "invalid_stock" });
      }
      if (isActiveRaw === null) {
        return res.status(400).json({ error: "invalid_is_active" });
      }
      const [created] = await db("inventory_skus")
        .insert({
          id: randomUUID(),
          supplier_sku: supplierSku,
          merch_type: merchType,
          quality_tier: qualityTier,
          size,
          color,
          stock,
          is_active: typeof isActiveRaw === "boolean" ? isActiveRaw : true,
          supplier_cost_cents: supplierCostCents,
          mrp_cents: mrpCents,
          metadata: db.raw("?::jsonb", [JSON.stringify(payload.metadata || {})]),
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning([
          "id",
          "supplier_sku",
          "merch_type",
          "quality_tier",
          "size",
          "color",
          "stock",
          "is_active",
          "supplier_cost_cents",
          "mrp_cents",
          "metadata",
          "created_at",
          "updated_at",
        ]);

      return res.status(201).json({
        item: toInventorySkuPayload(created),
      });
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
      const db = getDb();
      const payload = req.body || {};
      const merchType = parseNullableText(payload.merchType ?? payload.merch_type, {
        maxLength: 80,
      });
      const color = parseNullableText(payload.color, { maxLength: 64 });
      const size = parseNullableText(payload.size, { maxLength: 64 });
      if (!merchType) {
        return res.status(400).json({ error: "merch_type_required" });
      }

      const query = db("inventory_skus").where({ merch_type: merchType });
      if (color) query.andWhere({ color });
      if (size) query.andWhere({ size });
      const updatedCount = await query.update({
        is_active: false,
        updated_at: db.fn.now(),
      });

      return res.json({
        ok: true,
        updatedCount: Number(updatedCount || 0),
      });
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
      const db = getDb();
      const skuId = asUuidOrNull(req.params.id);
      if (!skuId) {
        return res.status(400).json({ error: "invalid_inventory_sku_id" });
      }

      const current = await db("inventory_skus").where({ id: skuId }).first();
      if (!current) {
        return res.status(404).json({ error: "inventory_sku_not_found" });
      }

      const payload = req.body || {};
      const patch = {};
      const supplierSku = parseNullableText(payload.supplierSku ?? payload.supplier_sku, {
        maxLength: 120,
      });
      const merchType = parseNullableText(payload.merchType ?? payload.merch_type, {
        maxLength: 80,
      });
      const qualityTier = parseNullableText(payload.qualityTier ?? payload.quality_tier, {
        maxLength: 80,
      });
      const size = parseNullableText(payload.size, { maxLength: 64 });
      const color = parseNullableText(payload.color, { maxLength: 64 });
      const parsedIsActive = parseBooleanMaybe(payload.isActive ?? payload.is_active);
      if (parsedIsActive === null) {
        return res.status(400).json({ error: "invalid_is_active" });
      }
      if (typeof parsedIsActive === "boolean") {
        patch.is_active = parsedIsActive;
      }
      if (typeof payload.supplierSku !== "undefined" || typeof payload.supplier_sku !== "undefined") {
        if (!supplierSku) {
          return res.status(400).json({ error: "supplier_sku_required" });
        }
        patch.supplier_sku = supplierSku;
      }
      if (typeof payload.merchType !== "undefined" || typeof payload.merch_type !== "undefined") {
        if (!merchType) {
          return res.status(400).json({ error: "merch_type_required" });
        }
        patch.merch_type = merchType;
      }
      if (typeof payload.qualityTier !== "undefined" || typeof payload.quality_tier !== "undefined") {
        patch.quality_tier = qualityTier;
      }
      if (typeof payload.size !== "undefined") {
        if (!size) {
          return res.status(400).json({ error: "size_required" });
        }
        patch.size = size;
      }
      if (typeof payload.color !== "undefined") {
        if (!color) {
          return res.status(400).json({ error: "color_required" });
        }
        patch.color = color;
      }

      const stockValueProvided =
        typeof payload.stock !== "undefined" || typeof payload.stock_cents !== "undefined";
      const stockDeltaProvided =
        typeof payload.stockDelta !== "undefined" || typeof payload.stock_delta !== "undefined";
      if (stockValueProvided && stockDeltaProvided) {
        return res.status(400).json({ error: "stock_and_stock_delta_conflict" });
      }

      if (stockValueProvided) {
        const parsedStock = parseNonNegativeInt(payload.stock ?? payload.stock_cents);
        if (parsedStock === null) {
          return res.status(400).json({ error: "invalid_stock" });
        }
        patch.stock = parsedStock;
      }

      if (stockDeltaProvided) {
        const stockDelta = parseInteger(payload.stockDelta ?? payload.stock_delta);
        if (stockDelta === null) {
          return res.status(400).json({ error: "invalid_stock_delta" });
        }
        const nextStock = Number(current.stock ?? 0) + stockDelta;
        if (nextStock < 0) {
          return res.status(400).json({ error: "invalid_stock" });
        }
        patch.stock = nextStock;
      }

      if (
        typeof payload.supplierCostCents !== "undefined" ||
        typeof payload.supplier_cost_cents !== "undefined"
      ) {
        const rawSupplierCost = payload.supplierCostCents ?? payload.supplier_cost_cents;
        if (rawSupplierCost === null || rawSupplierCost === "") {
          patch.supplier_cost_cents = null;
        } else {
          const parsed = parseNonNegativeInt(rawSupplierCost);
          if (parsed === null) {
            return res.status(400).json({ error: "invalid_supplier_cost_cents" });
          }
          patch.supplier_cost_cents = parsed;
        }
      }

      if (typeof payload.mrpCents !== "undefined" || typeof payload.mrp_cents !== "undefined") {
        const rawMrp = payload.mrpCents ?? payload.mrp_cents;
        if (rawMrp === null || rawMrp === "") {
          patch.mrp_cents = null;
        } else {
          const parsed = parseNonNegativeInt(rawMrp);
          if (parsed === null) {
            return res.status(400).json({ error: "invalid_mrp_cents" });
          }
          patch.mrp_cents = parsed;
        }
      }
      if (typeof payload.metadata !== "undefined") {
        if (payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)) {
          patch.metadata = db.raw("?::jsonb", [JSON.stringify(payload.metadata)]);
        } else if (payload.metadata === null) {
          patch.metadata = db.raw("'{}'::jsonb");
        } else {
          return res.status(400).json({ error: "invalid_metadata" });
        }
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "no_fields" });
      }
      patch.updated_at = db.fn.now();

      const [updated] = await db("inventory_skus")
        .where({ id: skuId })
        .update(patch)
        .returning([
          "id",
          "supplier_sku",
          "merch_type",
          "quality_tier",
          "size",
          "color",
          "stock",
          "is_active",
          "supplier_cost_cents",
          "mrp_cents",
          "metadata",
          "created_at",
          "updated_at",
        ]);

      return res.json({
        item: toInventorySkuPayload(updated),
      });
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
