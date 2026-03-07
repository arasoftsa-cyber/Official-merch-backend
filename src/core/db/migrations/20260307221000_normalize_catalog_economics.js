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

const addConstraintIfMissing = async (
  knex,
  tableName,
  constraintName,
  definitionSql
) => {
  if (await hasConstraint(knex, tableName, constraintName)) return;
  await knex.raw(
    `alter table ${tableName} add constraint ${constraintName} ${definitionSql}`
  );
};

exports.up = async (knex) => {
  const hasProducts = await knex.schema.hasTable("products");
  if (hasProducts) {
    const [
      hasMrpCents,
      hasSellingPriceCents,
      hasVendorPayoutCents,
      hasVendorPayCents,
      hasRoyaltyCents,
      hasOurShareCents,
    ] = await Promise.all([
      knex.schema.hasColumn("products", "mrp_cents"),
      knex.schema.hasColumn("products", "selling_price_cents"),
      knex.schema.hasColumn("products", "vendor_payout_cents"),
      knex.schema.hasColumn("products", "vendor_pay_cents"),
      knex.schema.hasColumn("products", "royalty_cents"),
      knex.schema.hasColumn("products", "our_share_cents"),
    ]);

    await knex.schema.alterTable("products", (table) => {
      if (!hasSellingPriceCents) table.integer("selling_price_cents");
      if (!hasVendorPayoutCents) table.integer("vendor_payout_cents");
    });

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

    await addConstraintIfMissing(
      knex,
      "products",
      "products_mrp_cents_non_negative_check",
      "check (mrp_cents is null or mrp_cents >= 0)"
    );
    await addConstraintIfMissing(
      knex,
      "products",
      "products_selling_price_cents_non_negative_check",
      "check (selling_price_cents is null or selling_price_cents >= 0)"
    );
    await addConstraintIfMissing(
      knex,
      "products",
      "products_vendor_payout_cents_non_negative_check",
      "check (vendor_payout_cents is null or vendor_payout_cents >= 0)"
    );
    if (hasRoyaltyCents) {
      await addConstraintIfMissing(
        knex,
        "products",
        "products_royalty_cents_non_negative_check",
        "check (royalty_cents is null or royalty_cents >= 0)"
      );
    }
    if (hasOurShareCents) {
      await addConstraintIfMissing(
        knex,
        "products",
        "products_our_share_cents_non_negative_check",
        "check (our_share_cents is null or our_share_cents >= 0)"
      );
    }

    if (hasMrpCents) {
      await knex.raw(`
        update products
           set selling_price_cents = coalesce(selling_price_cents, mrp_cents)
         where mrp_cents is not null
      `);
    }

    await knex.raw(`
      comment on column products.selling_price_cents is 'Optional product-level default; variant-level selling_price_cents is authoritative for checkout.'
    `);
    await knex.raw(`
      comment on column products.vendor_payout_cents is 'Optional product-level default payout; variant-level value is authoritative.'
    `);
    await knex.raw(`
      comment on column products.royalty_cents is 'Optional product-level default royalty; variant-level value is authoritative.'
    `);
    await knex.raw(`
      comment on column products.our_share_cents is 'Optional product-level default platform share; variant-level value is authoritative.'
    `);
  }

  const hasProductVariants = await knex.schema.hasTable("product_variants");
  if (hasProductVariants) {
    const [
      hasPriceCents,
      hasSellingPriceCents,
      hasVendorPayoutCents,
      hasRoyaltyCents,
      hasOurShareCents,
    ] = await Promise.all([
      knex.schema.hasColumn("product_variants", "price_cents"),
      knex.schema.hasColumn("product_variants", "selling_price_cents"),
      knex.schema.hasColumn("product_variants", "vendor_payout_cents"),
      knex.schema.hasColumn("product_variants", "royalty_cents"),
      knex.schema.hasColumn("product_variants", "our_share_cents"),
    ]);

    if (hasSellingPriceCents && hasPriceCents) {
      await knex.raw(`
        update product_variants
           set selling_price_cents = coalesce(selling_price_cents, price_cents)
         where price_cents is not null
      `);
    }

    if (hasOurShareCents && hasSellingPriceCents && hasVendorPayoutCents && hasRoyaltyCents) {
      await knex.raw(`
        update product_variants
           set our_share_cents = (selling_price_cents - vendor_payout_cents - royalty_cents)
         where our_share_cents is null
           and selling_price_cents is not null
           and vendor_payout_cents is not null
           and royalty_cents is not null
           and (selling_price_cents - vendor_payout_cents - royalty_cents) >= 0
      `);
    }
  }
};

exports.down = async (knex) => {
  const hasProducts = await knex.schema.hasTable("products");
  if (hasProducts) {
    await knex.raw(
      "alter table products drop constraint if exists products_mrp_cents_non_negative_check"
    );
    await knex.raw(
      "alter table products drop constraint if exists products_selling_price_cents_non_negative_check"
    );
    await knex.raw(
      "alter table products drop constraint if exists products_vendor_payout_cents_non_negative_check"
    );
    await knex.raw(
      "alter table products drop constraint if exists products_royalty_cents_non_negative_check"
    );
    await knex.raw(
      "alter table products drop constraint if exists products_our_share_cents_non_negative_check"
    );

    const [hasVendorPayCents, hasVendorPayoutCents, hasSellingPriceCents] =
      await Promise.all([
        knex.schema.hasColumn("products", "vendor_pay_cents"),
        knex.schema.hasColumn("products", "vendor_payout_cents"),
        knex.schema.hasColumn("products", "selling_price_cents"),
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
    if (hasSellingPriceCents) {
      await knex.schema.alterTable("products", (table) => {
        table.dropColumn("selling_price_cents");
      });
    }
  }
};

