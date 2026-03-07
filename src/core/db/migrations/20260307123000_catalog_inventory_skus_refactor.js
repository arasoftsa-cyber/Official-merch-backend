const crypto = require("crypto");

const MIGRATION_TAG = "20260307123000_catalog_inventory_skus_refactor";
const DEPRECATED_VARIANT_STOCK_NOTE =
  "Deprecated: product_variants.stock is a compatibility mirror. Source of truth is inventory_skus.stock.";

const readText = (value) => (typeof value === "string" ? value.trim() : "");

const parseNonNegativeInt = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
};

const normalizeSegment = (value, fallback) => {
  const base = readText(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || fallback;
};

const buildBackfillKey = ({ merchType, qualityTier, size, color }) =>
  [
    normalizeSegment(merchType, "default"),
    normalizeSegment(qualityTier || "na", "na"),
    normalizeSegment(size, "one_size"),
    normalizeSegment(color, "default"),
  ].join("|");

const buildSupplierSku = ({ merchType, qualityTier, size, color }) => {
  const normalizedMerchType = normalizeSegment(merchType, "default")
    .slice(0, 14)
    .toUpperCase();
  const normalizedColor = normalizeSegment(color, "default")
    .slice(0, 12)
    .toUpperCase();
  const normalizedSize = normalizeSegment(size, "one_size")
    .slice(0, 12)
    .toUpperCase();
  const normalizedQuality = normalizeSegment(qualityTier || "na", "NA")
    .slice(0, 10)
    .toUpperCase();
  const hash = crypto
    .createHash("sha1")
    .update(`${normalizedMerchType}|${normalizedQuality}|${normalizedColor}|${normalizedSize}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();

  return `BF-${normalizedMerchType}-${normalizedQuality}-${normalizedColor}-${normalizedSize}-${hash}`;
};

const hasConstraint = async (knex, tableName, constraintName) => {
  const row = await knex("pg_constraint as c")
    .join("pg_class as t", "t.oid", "c.conrelid")
    .join("pg_namespace as n", "n.oid", "t.relnamespace")
    .where("n.nspname", "public")
    .andWhere("t.relname", tableName)
    .andWhere("c.conname", constraintName)
    .first("c.conname");
  return Boolean(row);
};

const addConstraintIfMissing = async (knex, tableName, constraintName, definitionSql) => {
  const exists = await hasConstraint(knex, tableName, constraintName);
  if (exists) return;
  await knex.raw(
    `alter table ${tableName} add constraint ${constraintName} ${definitionSql}`
  );
};

exports.up = async (knex) => {
  const hasProductVariants = await knex.schema.hasTable("product_variants");
  if (!hasProductVariants) return;
  const hasProducts = await knex.schema.hasTable("products");

  const hasInventorySkus = await knex.schema.hasTable("inventory_skus");
  if (!hasInventorySkus) {
    await knex.schema.createTable("inventory_skus", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table.text("supplier_sku").notNullable().unique();
      table.text("merch_type").notNullable();
      table.text("quality_tier");
      table.text("size").notNullable();
      table.text("color").notNullable();
      table.integer("stock").notNullable().defaultTo(0);
      table.boolean("is_active").notNullable().defaultTo(true);
      table.integer("supplier_cost_cents");
      table.integer("mrp_cents");
      table.jsonb("metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  } else {
    const [
      hasId,
      hasSupplierSku,
      hasMerchType,
      hasQualityTier,
      hasSize,
      hasColor,
      hasStock,
      hasIsActive,
      hasSupplierCostCents,
      hasMrpCents,
      hasMetadata,
      hasCreatedAt,
      hasUpdatedAt,
    ] = await Promise.all([
      knex.schema.hasColumn("inventory_skus", "id"),
      knex.schema.hasColumn("inventory_skus", "supplier_sku"),
      knex.schema.hasColumn("inventory_skus", "merch_type"),
      knex.schema.hasColumn("inventory_skus", "quality_tier"),
      knex.schema.hasColumn("inventory_skus", "size"),
      knex.schema.hasColumn("inventory_skus", "color"),
      knex.schema.hasColumn("inventory_skus", "stock"),
      knex.schema.hasColumn("inventory_skus", "is_active"),
      knex.schema.hasColumn("inventory_skus", "supplier_cost_cents"),
      knex.schema.hasColumn("inventory_skus", "mrp_cents"),
      knex.schema.hasColumn("inventory_skus", "metadata"),
      knex.schema.hasColumn("inventory_skus", "created_at"),
      knex.schema.hasColumn("inventory_skus", "updated_at"),
    ]);

    await knex.schema.alterTable("inventory_skus", (table) => {
      if (!hasId) table.uuid("id").defaultTo(knex.raw("gen_random_uuid()"));
      if (!hasSupplierSku) table.text("supplier_sku");
      if (!hasMerchType) table.text("merch_type");
      if (!hasQualityTier) table.text("quality_tier");
      if (!hasSize) table.text("size");
      if (!hasColor) table.text("color");
      if (!hasStock) table.integer("stock");
      if (!hasIsActive) table.boolean("is_active");
      if (!hasSupplierCostCents) table.integer("supplier_cost_cents");
      if (!hasMrpCents) table.integer("mrp_cents");
      if (!hasMetadata) table.jsonb("metadata");
      if (!hasCreatedAt) table.timestamp("created_at", { useTz: true });
      if (!hasUpdatedAt) table.timestamp("updated_at", { useTz: true });
    });
  }

  await knex.raw(`
    update inventory_skus
       set id = gen_random_uuid()
     where id is null
  `);
  await knex.raw(`
    update inventory_skus
       set supplier_sku = concat('LEGACY-', id::text)
     where supplier_sku is null
        or btrim(supplier_sku) = ''
  `);
  await knex.raw(`
    update inventory_skus
       set merch_type = 'default'
     where merch_type is null
        or btrim(merch_type) = ''
  `);
  await knex.raw(`
    update inventory_skus
       set size = 'one_size'
     where size is null
        or btrim(size) = ''
  `);
  await knex.raw(`
    update inventory_skus
       set color = 'default'
     where color is null
        or btrim(color) = ''
  `);
  await knex.raw(`
    update inventory_skus
       set metadata = '{}'::jsonb
     where metadata is null
  `);
  await knex.raw(`
    alter table inventory_skus
      alter column id set not null
  `);
  await knex.raw(`
    update inventory_skus
       set stock = 0
     where stock is null
  `);
  await knex.raw(`
    update inventory_skus
       set is_active = true
     where is_active is null
  `);
  await knex.raw(`
    update inventory_skus
       set created_at = coalesce(created_at, now()),
           updated_at = coalesce(updated_at, created_at, now())
     where created_at is null
        or updated_at is null
  `);

  await knex.raw(`
    alter table inventory_skus
      alter column id set default gen_random_uuid(),
      alter column supplier_sku set not null,
      alter column merch_type set not null,
      alter column size set not null,
      alter column color set not null,
      alter column stock set default 0,
      alter column stock set not null,
      alter column is_active set default true,
      alter column is_active set not null,
      alter column metadata set default '{}'::jsonb,
      alter column metadata set not null,
      alter column created_at set default now(),
      alter column created_at set not null,
      alter column updated_at set default now(),
      alter column updated_at set not null
  `);

  await addConstraintIfMissing(
    knex,
    "inventory_skus",
    "inventory_skus_stock_non_negative_check",
    "check (stock >= 0)"
  );
  await addConstraintIfMissing(
    knex,
    "inventory_skus",
    "inventory_skus_supplier_cost_non_negative_check",
    "check (supplier_cost_cents is null or supplier_cost_cents >= 0)"
  );
  await addConstraintIfMissing(
    knex,
    "inventory_skus",
    "inventory_skus_mrp_non_negative_check",
    "check (mrp_cents is null or mrp_cents >= 0)"
  );

  await knex.raw(
    "create unique index if not exists inventory_skus_supplier_sku_unique_idx on inventory_skus (supplier_sku)"
  );
  await knex.raw(
    "create index if not exists inventory_skus_active_stock_idx on inventory_skus (is_active, stock)"
  );
  await knex.raw(
    "create index if not exists inventory_skus_merch_color_size_idx on inventory_skus (merch_type, color, size)"
  );

  const [
    hasInventorySkuId,
    hasIsListed,
    hasSellingPriceCents,
    hasVariantVendorPayoutCents,
    hasVariantRoyaltyCents,
    hasVariantOurShareCents,
    hasVariantUpdatedAt,
  ] = await Promise.all([
    knex.schema.hasColumn("product_variants", "inventory_sku_id"),
    knex.schema.hasColumn("product_variants", "is_listed"),
    knex.schema.hasColumn("product_variants", "selling_price_cents"),
    knex.schema.hasColumn("product_variants", "vendor_payout_cents"),
    knex.schema.hasColumn("product_variants", "royalty_cents"),
    knex.schema.hasColumn("product_variants", "our_share_cents"),
    knex.schema.hasColumn("product_variants", "updated_at"),
  ]);

  await knex.schema.alterTable("product_variants", (table) => {
    if (!hasInventorySkuId) table.uuid("inventory_sku_id");
    if (!hasIsListed) table.boolean("is_listed").notNullable().defaultTo(true);
    if (!hasSellingPriceCents) table.integer("selling_price_cents");
    if (!hasVariantVendorPayoutCents) table.integer("vendor_payout_cents");
    if (!hasVariantRoyaltyCents) table.integer("royalty_cents");
    if (!hasVariantOurShareCents) table.integer("our_share_cents");
    if (!hasVariantUpdatedAt) {
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    }
  });

  await knex.raw(`
    update product_variants
       set updated_at = coalesce(updated_at, created_at, now())
     where updated_at is null
  `);
  await knex.raw(`
    alter table product_variants
      alter column updated_at set default now(),
      alter column updated_at set not null
  `);

  await addConstraintIfMissing(
    knex,
    "product_variants",
    "product_variants_selling_price_cents_non_negative_check",
    "check (selling_price_cents is null or selling_price_cents >= 0)"
  );
  await addConstraintIfMissing(
    knex,
    "product_variants",
    "product_variants_vendor_payout_cents_non_negative_check",
    "check (vendor_payout_cents is null or vendor_payout_cents >= 0)"
  );
  await addConstraintIfMissing(
    knex,
    "product_variants",
    "product_variants_royalty_cents_non_negative_check",
    "check (royalty_cents is null or royalty_cents >= 0)"
  );
  await addConstraintIfMissing(
    knex,
    "product_variants",
    "product_variants_our_share_cents_non_negative_check",
    "check (our_share_cents is null or our_share_cents >= 0)"
  );

  await addConstraintIfMissing(
    knex,
    "product_variants",
    "product_variants_inventory_sku_id_fkey",
    "foreign key (inventory_sku_id) references inventory_skus(id)"
  );
  await knex.raw(
    "create index if not exists product_variants_inventory_sku_id_idx on product_variants (inventory_sku_id)"
  );

  if (hasProducts) {
    const [hasVendorPayCents, hasVendorPayoutCents] = await Promise.all([
      knex.schema.hasColumn("products", "vendor_pay_cents"),
      knex.schema.hasColumn("products", "vendor_payout_cents"),
    ]);

    if (hasVendorPayCents && !hasVendorPayoutCents) {
      await knex.schema.alterTable("products", (table) => {
        table.integer("vendor_payout_cents");
      });
    }

    if (hasVendorPayCents) {
      await knex.raw(`
        update products
           set vendor_payout_cents = coalesce(vendor_payout_cents, vendor_pay_cents)
         where vendor_pay_cents is not null
      `);

      await knex.schema.alterTable("products", (table) => {
        table.dropColumn("vendor_pay_cents");
      });
    }
  }

  const productVariantColumns = await knex("product_variants").columnInfo();
  const productColumns = hasProducts ? await knex("products").columnInfo() : {};

  let variantQuery = knex("product_variants as pv").select("pv.id", "pv.product_id");
  if (Object.prototype.hasOwnProperty.call(productVariantColumns, "inventory_sku_id")) {
    variantQuery = variantQuery.select("pv.inventory_sku_id");
  }
  if (Object.prototype.hasOwnProperty.call(productVariantColumns, "size")) {
    variantQuery = variantQuery.select("pv.size");
  }
  if (Object.prototype.hasOwnProperty.call(productVariantColumns, "color")) {
    variantQuery = variantQuery.select("pv.color");
  }
  if (Object.prototype.hasOwnProperty.call(productVariantColumns, "stock")) {
    variantQuery = variantQuery.select("pv.stock");
  }
  if (Object.prototype.hasOwnProperty.call(productVariantColumns, "merch_type")) {
    variantQuery = variantQuery.select("pv.merch_type as variant_merch_type");
  }
  if (Object.prototype.hasOwnProperty.call(productVariantColumns, "quality_tier")) {
    variantQuery = variantQuery.select("pv.quality_tier as variant_quality_tier");
  }
  if (Object.prototype.hasOwnProperty.call(productVariantColumns, "supplier_cost_cents")) {
    variantQuery = variantQuery.select("pv.supplier_cost_cents as variant_supplier_cost_cents");
  }
  if (Object.prototype.hasOwnProperty.call(productVariantColumns, "mrp_cents")) {
    variantQuery = variantQuery.select("pv.mrp_cents as variant_mrp_cents");
  }

  if (hasProducts) {
    variantQuery = variantQuery.leftJoin("products as p", "p.id", "pv.product_id");
    if (Object.prototype.hasOwnProperty.call(productColumns, "merch_type")) {
      variantQuery = variantQuery.select("p.merch_type as product_merch_type");
    }
    if (Object.prototype.hasOwnProperty.call(productColumns, "mrp_cents")) {
      variantQuery = variantQuery.select("p.mrp_cents as product_mrp_cents");
    }
  }

  const variantRows = await variantQuery;
  const comboMap = new Map();

  for (const row of variantRows) {
    const merchType = normalizeSegment(
      row.variant_merch_type || row.product_merch_type || "default",
      "default"
    );
    const qualityTierValue = readText(row.variant_quality_tier || "");
    const qualityTier = qualityTierValue ? normalizeSegment(qualityTierValue, "na") : null;
    const size = normalizeSegment(row.size || "one_size", "one_size");
    const color = normalizeSegment(row.color || "default", "default");
    const key = buildBackfillKey({
      merchType,
      qualityTier,
      size,
      color,
    });

    if (!comboMap.has(key)) {
      comboMap.set(key, {
        key,
        merchType,
        qualityTier,
        size,
        color,
        stock: 0,
        supplierCostCents: null,
        mrpCents: null,
        variantsToMap: [],
      });
    }

    const combo = comboMap.get(key);
    const stock = parseNonNegativeInt(row.stock);
    combo.stock += stock || 0;

    const variantSupplierCost = parseNonNegativeInt(row.variant_supplier_cost_cents);
    if (combo.supplierCostCents === null && variantSupplierCost !== null) {
      combo.supplierCostCents = variantSupplierCost;
    }

    const variantMrp = parseNonNegativeInt(row.variant_mrp_cents);
    const productMrp = parseNonNegativeInt(row.product_mrp_cents);
    if (combo.mrpCents === null && variantMrp !== null) combo.mrpCents = variantMrp;
    if (combo.mrpCents === null && productMrp !== null) combo.mrpCents = productMrp;

    if (!row.inventory_sku_id) {
      combo.variantsToMap.push({
        id: row.id,
        productId: row.product_id,
      });
    }
  }

  for (const combo of comboMap.values()) {
    const supplierSku = buildSupplierSku(combo);
    combo.supplierSku = supplierSku;
    await knex("inventory_skus")
      .insert({
        supplier_sku: supplierSku,
        merch_type: combo.merchType,
        quality_tier: combo.qualityTier,
        size: combo.size,
        color: combo.color,
        stock: combo.stock,
        is_active: true,
        supplier_cost_cents: combo.supplierCostCents,
        mrp_cents: combo.mrpCents,
        metadata: {
          backfill: {
            source: "product_variants",
            key: combo.key,
            migration: MIGRATION_TAG,
            note: "transitional supplier_sku generated; replace with upstream supplier code",
          },
        },
      })
      .onConflict("supplier_sku")
      .ignore();

    const skuRow = await knex("inventory_skus")
      .select("id")
      .where({ supplier_sku: supplierSku })
      .first();
    combo.inventorySkuId = skuRow?.id || null;
  }

  const existingMappedRows = await knex("product_variants")
    .select("product_id", "inventory_sku_id")
    .whereNotNull("inventory_sku_id");
  const assignmentSet = new Set(
    existingMappedRows.map((row) => `${row.product_id}|${row.inventory_sku_id}`)
  );

  let skippedDuplicateMappings = 0;
  for (const combo of comboMap.values()) {
    if (!combo.inventorySkuId) continue;
    for (const variant of combo.variantsToMap) {
      const assignmentKey = `${variant.productId}|${combo.inventorySkuId}`;
      if (assignmentSet.has(assignmentKey)) {
        skippedDuplicateMappings += 1;
        continue;
      }
      await knex("product_variants")
        .where({ id: variant.id })
        .whereNull("inventory_sku_id")
        .update({
          inventory_sku_id: combo.inventorySkuId,
          updated_at: knex.fn.now(),
        });
      assignmentSet.add(assignmentKey);
    }
  }

  if (skippedDuplicateMappings > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[${MIGRATION_TAG}] skipped ${skippedDuplicateMappings} duplicate product->inventory_sku links to preserve unique(product_id, inventory_sku_id).`
    );
  }

  if (Object.prototype.hasOwnProperty.call(productVariantColumns, "stock")) {
    await knex.raw(`
      update product_variants pv
         set stock = sk.stock,
             updated_at = now()
        from inventory_skus sk
       where pv.inventory_sku_id = sk.id
         and pv.stock is distinct from sk.stock
    `);
    await knex.raw(`
      comment on column product_variants.stock is '${DEPRECATED_VARIANT_STOCK_NOTE}'
    `);
  }
  await knex.raw(`
    comment on column inventory_skus.stock is 'Source of truth for supplier stock and availability.'
  `);
  await knex.raw(`
    create or replace function sync_inventory_sku_stock_to_variants()
    returns trigger
    language plpgsql
    as $$
    begin
      update product_variants
         set stock = new.stock,
             updated_at = now()
       where inventory_sku_id = new.id
         and stock is distinct from new.stock;
      return new;
    end;
    $$;
  `);
  await knex.raw(`
    drop trigger if exists inventory_skus_sync_variant_stock_trg on inventory_skus
  `);
  await knex.raw(`
    create trigger inventory_skus_sync_variant_stock_trg
    after update of stock on inventory_skus
    for each row
    execute function sync_inventory_sku_stock_to_variants()
  `);
  await knex.raw(`
    create or replace function sync_variant_stock_to_inventory_skus()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.inventory_sku_id is null then
        return new;
      end if;

      if tg_op = 'UPDATE'
         and new.inventory_sku_id = old.inventory_sku_id
         and new.stock is not distinct from old.stock then
        return new;
      end if;

      update inventory_skus
         set stock = greatest(new.stock, 0),
             updated_at = now()
       where id = new.inventory_sku_id
         and stock is distinct from greatest(new.stock, 0);
      return new;
    end;
    $$;
  `);
  await knex.raw(`
    drop trigger if exists product_variants_sync_inventory_sku_stock_trg on product_variants
  `);
  await knex.raw(`
    create trigger product_variants_sync_inventory_sku_stock_trg
    after insert or update of stock, inventory_sku_id on product_variants
    for each row
    execute function sync_variant_stock_to_inventory_skus()
  `);

  const duplicateLinkedRows = await knex("product_variants")
    .select("product_id", "inventory_sku_id")
    .whereNotNull("inventory_sku_id")
    .groupBy("product_id", "inventory_sku_id")
    .havingRaw("count(*) > 1")
    .limit(1);

  if (duplicateLinkedRows.length === 0) {
    await addConstraintIfMissing(
      knex,
      "product_variants",
      "product_variants_product_id_inventory_sku_id_unique",
      "unique (product_id, inventory_sku_id)"
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[${MIGRATION_TAG}] unique(product_id, inventory_sku_id) not added due to duplicate legacy rows.`
    );
  }

  const nullInventorySkuCountRow = await knex("product_variants")
    .whereNull("inventory_sku_id")
    .count({ count: "*" })
    .first();
  const nullInventorySkuCount = Number(nullInventorySkuCountRow?.count || 0);

  if (nullInventorySkuCount === 0) {
    await knex.raw(`
      alter table product_variants
      alter column inventory_sku_id set not null
    `);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[${MIGRATION_TAG}] inventory_sku_id remains nullable (${nullInventorySkuCount} rows unmapped). Phase 2 hardening required.`
    );
  }
};

exports.down = async (knex) => {
  const hasInventorySkus = await knex.schema.hasTable("inventory_skus");
  const hasProducts = await knex.schema.hasTable("products");
  if (hasProducts) {
    const [hasVendorPayCents, hasVendorPayoutCents] = await Promise.all([
      knex.schema.hasColumn("products", "vendor_pay_cents"),
      knex.schema.hasColumn("products", "vendor_payout_cents"),
    ]);

    if (!hasVendorPayCents && hasVendorPayoutCents) {
      await knex.schema.alterTable("products", (table) => {
        table.integer("vendor_pay_cents");
      });
      await knex.raw(`
        update products
           set vendor_pay_cents = vendor_payout_cents
         where vendor_pay_cents is null
           and vendor_payout_cents is not null
      `);
    }
  }

  const hasProductVariants = await knex.schema.hasTable("product_variants");
  if (hasProductVariants) {
    await knex.raw(`
      drop trigger if exists product_variants_sync_inventory_sku_stock_trg on product_variants
    `);
    if (hasInventorySkus) {
      await knex.raw(`
        drop trigger if exists inventory_skus_sync_variant_stock_trg on inventory_skus
      `);
    }

    await knex.raw(`
      alter table product_variants
      drop constraint if exists product_variants_product_id_inventory_sku_id_unique
    `);
    await knex.raw(`
      alter table product_variants
      drop constraint if exists product_variants_inventory_sku_id_fkey
    `);
    await knex.raw(`
      alter table product_variants
      drop constraint if exists product_variants_selling_price_cents_non_negative_check
    `);
    await knex.raw(`
      alter table product_variants
      drop constraint if exists product_variants_vendor_payout_cents_non_negative_check
    `);
    await knex.raw(`
      alter table product_variants
      drop constraint if exists product_variants_royalty_cents_non_negative_check
    `);
    await knex.raw(`
      alter table product_variants
      drop constraint if exists product_variants_our_share_cents_non_negative_check
    `);
    await knex.raw("drop index if exists product_variants_inventory_sku_id_idx");

    const [
      hasInventorySkuId,
      hasIsListed,
      hasSellingPriceCents,
      hasVariantVendorPayoutCents,
      hasVariantRoyaltyCents,
      hasVariantOurShareCents,
      hasVariantUpdatedAt,
    ] = await Promise.all([
      knex.schema.hasColumn("product_variants", "inventory_sku_id"),
      knex.schema.hasColumn("product_variants", "is_listed"),
      knex.schema.hasColumn("product_variants", "selling_price_cents"),
      knex.schema.hasColumn("product_variants", "vendor_payout_cents"),
      knex.schema.hasColumn("product_variants", "royalty_cents"),
      knex.schema.hasColumn("product_variants", "our_share_cents"),
      knex.schema.hasColumn("product_variants", "updated_at"),
    ]);

    await knex.schema.alterTable("product_variants", (table) => {
      if (hasInventorySkuId) table.dropColumn("inventory_sku_id");
      if (hasIsListed) table.dropColumn("is_listed");
      if (hasSellingPriceCents) table.dropColumn("selling_price_cents");
      if (hasVariantVendorPayoutCents) table.dropColumn("vendor_payout_cents");
      if (hasVariantRoyaltyCents) table.dropColumn("royalty_cents");
      if (hasVariantOurShareCents) table.dropColumn("our_share_cents");
      if (hasVariantUpdatedAt) table.dropColumn("updated_at");
    });
  }

  await knex.raw("drop function if exists sync_variant_stock_to_inventory_skus()");
  await knex.raw("drop function if exists sync_inventory_sku_stock_to_variants()");

  if (hasInventorySkus) {
    await knex.schema.dropTableIfExists("inventory_skus");
  }
};
