const {
  buildVariantInventoryQuery,
  formatVariantInventoryRow,
} = require("../services/variantAvailability.service");

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

const findProductById = async (db, productId) => db("products").where({ id: productId }).first();
const findVariantById = async (db, variantId) =>
  db("product_variants").where({ id: variantId }).first();
const deleteVariantById = async (db, variantId) => db("product_variants").where({ id: variantId }).del();

module.exports = {
  toInventorySkuPayload,
  listVariantsForProduct,
  orderVariantsByTouchedIds,
  findProductById,
  findVariantById,
  deleteVariantById,
};
