const addConstraintIfMissing = async (knex, tableName, constraintName, definitionSql) => {
  const rows = await knex.raw(
    `
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      where t.relname = ? and c.conname = ?
      limit 1
    `,
    [tableName, constraintName]
  );
  const exists = Boolean(rows?.rows?.[0]);
  if (!exists) {
    await knex.raw(
      `alter table ${tableName} add constraint ${constraintName} ${definitionSql}`
    );
  }
};

exports.up = async (knex) => {
  const hasOrderItems = await knex.schema.hasTable("order_items");
  if (!hasOrderItems) return;
  const hasProductVariants = await knex.schema.hasTable("product_variants");
  const hasInventorySkus = await knex.schema.hasTable("inventory_skus");

  const [
    hasInventorySkuId,
    hasSupplierSku,
    hasMerchType,
    hasQualityTier,
    hasSize,
    hasColor,
    hasSellingPriceCents,
    hasVendorPayoutCents,
    hasRoyaltyCents,
    hasOurShareCents,
  ] = await Promise.all([
    knex.schema.hasColumn("order_items", "inventory_sku_id"),
    knex.schema.hasColumn("order_items", "supplier_sku"),
    knex.schema.hasColumn("order_items", "merch_type"),
    knex.schema.hasColumn("order_items", "quality_tier"),
    knex.schema.hasColumn("order_items", "size"),
    knex.schema.hasColumn("order_items", "color"),
    knex.schema.hasColumn("order_items", "selling_price_cents"),
    knex.schema.hasColumn("order_items", "vendor_payout_cents"),
    knex.schema.hasColumn("order_items", "royalty_cents"),
    knex.schema.hasColumn("order_items", "our_share_cents"),
  ]);

  await knex.schema.alterTable("order_items", (table) => {
    if (!hasInventorySkuId) table.uuid("inventory_sku_id");
    if (!hasSupplierSku) table.text("supplier_sku");
    if (!hasMerchType) table.text("merch_type");
    if (!hasQualityTier) table.text("quality_tier");
    if (!hasSize) table.text("size");
    if (!hasColor) table.text("color");
    if (!hasSellingPriceCents) table.integer("selling_price_cents");
    if (!hasVendorPayoutCents) table.integer("vendor_payout_cents");
    if (!hasRoyaltyCents) table.integer("royalty_cents");
    if (!hasOurShareCents) table.integer("our_share_cents");
  });

  if (hasProductVariants && hasInventorySkus) {
    await knex.raw(`
      update order_items oi
         set selling_price_cents = coalesce(oi.selling_price_cents, oi.price_cents),
             inventory_sku_id = coalesce(oi.inventory_sku_id, pv.inventory_sku_id),
             vendor_payout_cents = coalesce(oi.vendor_payout_cents, pv.vendor_payout_cents),
             royalty_cents = coalesce(oi.royalty_cents, pv.royalty_cents),
             our_share_cents = coalesce(oi.our_share_cents, pv.our_share_cents),
             size = coalesce(oi.size, pv.size, sk.size),
             color = coalesce(oi.color, pv.color, sk.color),
             supplier_sku = coalesce(oi.supplier_sku, sk.supplier_sku),
             merch_type = coalesce(oi.merch_type, sk.merch_type),
             quality_tier = coalesce(oi.quality_tier, sk.quality_tier)
        from product_variants pv
        left join inventory_skus sk on sk.id = pv.inventory_sku_id
       where oi.product_variant_id = pv.id
    `);
  } else if (hasProductVariants) {
    await knex.raw(`
      update order_items oi
         set selling_price_cents = coalesce(oi.selling_price_cents, oi.price_cents),
             vendor_payout_cents = coalesce(oi.vendor_payout_cents, pv.vendor_payout_cents),
             royalty_cents = coalesce(oi.royalty_cents, pv.royalty_cents),
             our_share_cents = coalesce(oi.our_share_cents, pv.our_share_cents),
             size = coalesce(oi.size, pv.size),
             color = coalesce(oi.color, pv.color)
        from product_variants pv
       where oi.product_variant_id = pv.id
    `);
  } else {
    await knex.raw(`
      update order_items
         set selling_price_cents = coalesce(selling_price_cents, price_cents)
    `);
  }

  await knex.raw(`
    update order_items
       set our_share_cents = (selling_price_cents - vendor_payout_cents - royalty_cents)
     where our_share_cents is null
       and selling_price_cents is not null
       and vendor_payout_cents is not null
       and royalty_cents is not null
       and (selling_price_cents - vendor_payout_cents - royalty_cents) >= 0
  `);

  await knex.raw(
    "create index if not exists order_items_inventory_sku_id_idx on order_items (inventory_sku_id)"
  );

  if (hasInventorySkus) {
    await addConstraintIfMissing(
      knex,
      "order_items",
      "order_items_inventory_sku_id_fkey",
      "foreign key (inventory_sku_id) references inventory_skus(id)"
    );
  }

  await addConstraintIfMissing(
    knex,
    "order_items",
    "order_items_selling_price_cents_non_negative_check",
    "check (selling_price_cents is null or selling_price_cents >= 0)"
  );
  await addConstraintIfMissing(
    knex,
    "order_items",
    "order_items_vendor_payout_cents_non_negative_check",
    "check (vendor_payout_cents is null or vendor_payout_cents >= 0)"
  );
  await addConstraintIfMissing(
    knex,
    "order_items",
    "order_items_royalty_cents_non_negative_check",
    "check (royalty_cents is null or royalty_cents >= 0)"
  );
  await addConstraintIfMissing(
    knex,
    "order_items",
    "order_items_our_share_cents_non_negative_check",
    "check (our_share_cents is null or our_share_cents >= 0)"
  );
};

exports.down = async (knex) => {
  const hasOrderItems = await knex.schema.hasTable("order_items");
  if (!hasOrderItems) return;

  await knex.raw(
    "alter table order_items drop constraint if exists order_items_inventory_sku_id_fkey"
  );
  await knex.raw(
    "alter table order_items drop constraint if exists order_items_selling_price_cents_non_negative_check"
  );
  await knex.raw(
    "alter table order_items drop constraint if exists order_items_vendor_payout_cents_non_negative_check"
  );
  await knex.raw(
    "alter table order_items drop constraint if exists order_items_royalty_cents_non_negative_check"
  );
  await knex.raw(
    "alter table order_items drop constraint if exists order_items_our_share_cents_non_negative_check"
  );
  await knex.raw("drop index if exists order_items_inventory_sku_id_idx");

  const [
    hasInventorySkuId,
    hasSupplierSku,
    hasMerchType,
    hasQualityTier,
    hasSize,
    hasColor,
    hasSellingPriceCents,
    hasVendorPayoutCents,
    hasRoyaltyCents,
    hasOurShareCents,
  ] = await Promise.all([
    knex.schema.hasColumn("order_items", "inventory_sku_id"),
    knex.schema.hasColumn("order_items", "supplier_sku"),
    knex.schema.hasColumn("order_items", "merch_type"),
    knex.schema.hasColumn("order_items", "quality_tier"),
    knex.schema.hasColumn("order_items", "size"),
    knex.schema.hasColumn("order_items", "color"),
    knex.schema.hasColumn("order_items", "selling_price_cents"),
    knex.schema.hasColumn("order_items", "vendor_payout_cents"),
    knex.schema.hasColumn("order_items", "royalty_cents"),
    knex.schema.hasColumn("order_items", "our_share_cents"),
  ]);

  await knex.schema.alterTable("order_items", (table) => {
    if (hasInventorySkuId) table.dropColumn("inventory_sku_id");
    if (hasSupplierSku) table.dropColumn("supplier_sku");
    if (hasMerchType) table.dropColumn("merch_type");
    if (hasQualityTier) table.dropColumn("quality_tier");
    if (hasSize) table.dropColumn("size");
    if (hasColor) table.dropColumn("color");
    if (hasSellingPriceCents) table.dropColumn("selling_price_cents");
    if (hasVendorPayoutCents) table.dropColumn("vendor_payout_cents");
    if (hasRoyaltyCents) table.dropColumn("royalty_cents");
    if (hasOurShareCents) table.dropColumn("our_share_cents");
  });
};
