exports.up = async (knex) => {
  const hasProducts = await knex.schema.hasTable("products");
  if (hasProducts) {
    const [
      hasMerchStory,
      hasMrpCents,
      hasVendorPayCents,
      hasOurShareCents,
      hasRoyaltyCents,
      hasMerchType,
      hasColors,
      hasVendorPayoutCents,
    ] = await Promise.all([
      knex.schema.hasColumn("products", "merch_story"),
      knex.schema.hasColumn("products", "mrp_cents"),
      knex.schema.hasColumn("products", "vendor_pay_cents"),
      knex.schema.hasColumn("products", "our_share_cents"),
      knex.schema.hasColumn("products", "royalty_cents"),
      knex.schema.hasColumn("products", "merch_type"),
      knex.schema.hasColumn("products", "colors"),
      knex.schema.hasColumn("products", "vendor_payout_cents"),
    ]);

    await knex.schema.alterTable("products", (table) => {
      if (!hasMerchStory) table.text("merch_story");
      if (!hasMrpCents) table.integer("mrp_cents");
      if (!hasVendorPayCents) table.integer("vendor_pay_cents");
      if (!hasOurShareCents) table.integer("our_share_cents");
      if (!hasRoyaltyCents) table.integer("royalty_cents");
      if (!hasMerchType) table.text("merch_type");
      if (!hasColors) table.jsonb("colors");
    });

    if (hasVendorPayoutCents) {
      await knex.raw(`
        update products
           set vendor_pay_cents = vendor_payout_cents
         where vendor_pay_cents is null
           and vendor_payout_cents is not null
      `);
    }
  }

  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (hasEntityMediaLinks) {
    await knex.raw(`
      alter table entity_media_links
      drop constraint if exists entity_media_links_role_check
    `);
    await knex.raw(`
      alter table entity_media_links
      add constraint entity_media_links_role_check
      check (role in ('cover', 'avatar', 'gallery', 'profile_photo', 'listing_photo'))
    `);

    await knex.raw(`
      create unique index if not exists entity_media_links_listing_photo_sort_unique
        on entity_media_links (entity_type, entity_id, sort_order)
        where role = 'listing_photo'
    `);
  }
};

exports.down = async (knex) => {
  await knex.raw("drop index if exists entity_media_links_listing_photo_sort_unique");

  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (hasEntityMediaLinks) {
    await knex.raw(`
      alter table entity_media_links
      drop constraint if exists entity_media_links_role_check
    `);
    await knex.raw(`
      alter table entity_media_links
      add constraint entity_media_links_role_check
      check (role in ('cover', 'avatar', 'gallery', 'profile_photo'))
    `);
  }

  const hasProducts = await knex.schema.hasTable("products");
  if (!hasProducts) return;

  const [
    hasMerchStory,
    hasMrpCents,
    hasVendorPayCents,
    hasOurShareCents,
    hasRoyaltyCents,
    hasMerchType,
    hasColors,
  ] = await Promise.all([
    knex.schema.hasColumn("products", "merch_story"),
    knex.schema.hasColumn("products", "mrp_cents"),
    knex.schema.hasColumn("products", "vendor_pay_cents"),
    knex.schema.hasColumn("products", "our_share_cents"),
    knex.schema.hasColumn("products", "royalty_cents"),
    knex.schema.hasColumn("products", "merch_type"),
    knex.schema.hasColumn("products", "colors"),
  ]);

  await knex.schema.alterTable("products", (table) => {
    if (hasMerchStory) table.dropColumn("merch_story");
    if (hasMrpCents) table.dropColumn("mrp_cents");
    if (hasVendorPayCents) table.dropColumn("vendor_pay_cents");
    if (hasOurShareCents) table.dropColumn("our_share_cents");
    if (hasRoyaltyCents) table.dropColumn("royalty_cents");
    if (hasMerchType) table.dropColumn("merch_type");
    if (hasColors) table.dropColumn("colors");
  });
};
