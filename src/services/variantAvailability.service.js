const asNullableNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const { deriveOurShareCents } = require("../utils/economics");

const asBoolean = (value) => value === true || value === "true" || value === 1 || value === "1";

const buildEffectiveActiveSql = ({
  productAlias = "p",
  variantAlias = "pv",
  skuAlias = "sk",
} = {}) =>
  `(coalesce(${productAlias}.is_active, false) = true and coalesce(${variantAlias}.is_listed, true) = true and coalesce(${skuAlias}.is_active, false) = true)`;

const buildEffectiveSellableSql = (aliases = {}) =>
  `${buildEffectiveActiveSql(aliases)} and coalesce(${aliases.skuAlias || "sk"}.stock, 0) > 0`;

const buildVariantPriceSql = ({ variantAlias = "pv" } = {}) =>
  `coalesce(${variantAlias}.selling_price_cents, ${variantAlias}.price_cents)`;

const buildSellableMinPriceSubquery = (db, { productRef = "products.id" } = {}) =>
  db.raw(
    `(
      select min(${buildVariantPriceSql({ variantAlias: "v" })})
      from product_variants v
      join inventory_skus sk on sk.id = v.inventory_sku_id
      where v.product_id = ${productRef}
        and coalesce(v.is_listed, true) = true
        and sk.is_active = true
        and sk.stock > 0
    )`
  );

const applySellableVariantExists = (query, { productRef = "products.id" } = {}) =>
  query.whereExists((builder) => {
    builder
      .select(1)
      .from("product_variants as v")
      .join("inventory_skus as sk", "sk.id", "v.inventory_sku_id")
      .whereRaw(`v.product_id = ${productRef}`)
      .whereRaw("coalesce(v.is_listed, true) = true")
      .andWhere("sk.is_active", true)
      .andWhere("sk.stock", ">", 0);
  });

const selectVariantInventoryColumns = (
  db,
  { productAlias = "p", variantAlias = "pv", skuAlias = "sk" } = {}
) => {
  const effectiveActiveSql = buildEffectiveActiveSql({
    productAlias,
    variantAlias,
    skuAlias,
  });
  const effectiveSellableSql = buildEffectiveSellableSql({
    productAlias,
    variantAlias,
    skuAlias,
  });
  const priceSql = buildVariantPriceSql({ variantAlias });
  return [
    `${variantAlias}.id`,
    `${variantAlias}.product_id`,
    `${variantAlias}.sku`,
    db.raw(
      `coalesce(nullif(${variantAlias}.size, ''), ${skuAlias}.size, 'default') as size`
    ),
    db.raw(
      `coalesce(nullif(${variantAlias}.color, ''), ${skuAlias}.color, 'default') as color`
    ),
    `${variantAlias}.inventory_sku_id`,
    `${skuAlias}.supplier_sku`,
    `${skuAlias}.merch_type`,
    `${skuAlias}.quality_tier`,
    db.raw(`coalesce(${skuAlias}.stock, 0) as stock`),
    db.raw(`coalesce(${skuAlias}.is_active, false) as sku_is_active`),
    db.raw(`coalesce(${variantAlias}.is_listed, true) as variant_is_listed`),
    db.raw(`${priceSql} as price_cents`),
    db.raw(`${priceSql} as selling_price_cents`),
    `${variantAlias}.vendor_payout_cents`,
    `${variantAlias}.royalty_cents`,
    `${variantAlias}.our_share_cents`,
    db.raw(`${effectiveActiveSql} as effective_is_active`),
    db.raw(`${effectiveSellableSql} as effective_sellable`),
  ];
};

const buildVariantInventoryQuery = (db, { productId } = {}) => {
  const query = db("product_variants as pv")
    .join("products as p", "p.id", "pv.product_id")
    .leftJoin("inventory_skus as sk", "sk.id", "pv.inventory_sku_id")
    .select(selectVariantInventoryColumns(db));
  if (productId) {
    query.where("pv.product_id", productId);
  }
  return query;
};

const formatVariantInventoryRow = (row) => {
  if (!row) return null;
  const stock = asNullableNumber(row.stock);
  const priceCents = asNullableNumber(row.selling_price_cents ?? row.price_cents);
  const vendorPayoutCents = asNullableNumber(row.vendor_payout_cents);
  const royaltyCents = asNullableNumber(row.royalty_cents);
  const explicitOurShareCents = asNullableNumber(row.our_share_cents);
  const derivedOurShareCents =
    explicitOurShareCents === null
      ? deriveOurShareCents({
          sellingPriceCents: priceCents,
          vendorPayoutCents,
          royaltyCents,
        })
      : null;
  const ourShareCents =
    explicitOurShareCents === null ? derivedOurShareCents : explicitOurShareCents;
  const skuIsActive = asBoolean(row.sku_is_active);
  const variantIsListed = asBoolean(row.variant_is_listed);
  const effectiveIsActive = asBoolean(row.effective_is_active);
  const effectiveSellable = asBoolean(row.effective_sellable);

  return {
    id: row.id,
    product_id: row.product_id,
    productId: row.product_id,
    sku: row.sku,
    size: row.size,
    color: row.color,
    inventory_sku_id: row.inventory_sku_id,
    inventorySkuId: row.inventory_sku_id,
    supplier_sku: row.supplier_sku || null,
    supplierSku: row.supplier_sku || null,
    merch_type: row.merch_type || null,
    merchType: row.merch_type || null,
    quality_tier: row.quality_tier || null,
    qualityTier: row.quality_tier || null,
    stock: stock == null ? 0 : stock,
    sku_is_active: skuIsActive,
    skuIsActive,
    variant_is_listed: variantIsListed,
    variantIsListed,
    effective_is_active: effectiveIsActive,
    effectiveIsActive,
    effective_sellable: effectiveSellable,
    effectiveSellable,
    price_cents: priceCents,
    priceCents,
    selling_price_cents: priceCents,
    sellingPriceCents: priceCents,
    vendor_payout_cents: vendorPayoutCents,
    vendorPayoutCents,
    royalty_cents: royaltyCents,
    royaltyCents,
    our_share_cents: ourShareCents,
    ourShareCents,
  };
};

module.exports = {
  buildEffectiveActiveSql,
  buildEffectiveSellableSql,
  buildVariantPriceSql,
  buildSellableMinPriceSubquery,
  applySellableVariantExists,
  selectVariantInventoryColumns,
  buildVariantInventoryQuery,
  formatVariantInventoryRow,
};
