exports.up = async (knex) => {
  const hasProducts = await knex.schema.hasTable("products");
  if (!hasProducts) return;

  const [
    hasMerchStory,
    hasMrpCents,
    hasVendorPayoutCents,
    hasOurShareCents,
    hasRoyaltyCents,
    hasMerchType,
    hasColors,
    hasListingPhotos,
    hasIsActive,
  ] = await Promise.all([
    knex.schema.hasColumn("products", "merch_story"),
    knex.schema.hasColumn("products", "mrp_cents"),
    knex.schema.hasColumn("products", "vendor_payout_cents"),
    knex.schema.hasColumn("products", "our_share_cents"),
    knex.schema.hasColumn("products", "royalty_cents"),
    knex.schema.hasColumn("products", "merch_type"),
    knex.schema.hasColumn("products", "colors"),
    knex.schema.hasColumn("products", "listing_photos"),
    knex.schema.hasColumn("products", "is_active"),
  ]);

  await knex.schema.alterTable("products", (table) => {
    if (!hasMerchStory) table.text("merch_story");
    if (!hasMrpCents) table.integer("mrp_cents");
    if (!hasVendorPayoutCents) table.integer("vendor_payout_cents");
    if (!hasOurShareCents) table.integer("our_share_cents");
    if (!hasRoyaltyCents) table.integer("royalty_cents");
    if (!hasMerchType) table.text("merch_type");
    if (!hasColors) table.jsonb("colors");
    if (!hasListingPhotos) table.jsonb("listing_photos");
    if (!hasIsActive) table.boolean("is_active").notNullable().defaultTo(false);
  });
};

exports.down = async (knex) => {
  const hasProducts = await knex.schema.hasTable("products");
  if (!hasProducts) return;

  const [
    hasMerchStory,
    hasMrpCents,
    hasVendorPayoutCents,
    hasOurShareCents,
    hasRoyaltyCents,
    hasMerchType,
    hasColors,
    hasListingPhotos,
    hasIsActive,
  ] = await Promise.all([
    knex.schema.hasColumn("products", "merch_story"),
    knex.schema.hasColumn("products", "mrp_cents"),
    knex.schema.hasColumn("products", "vendor_payout_cents"),
    knex.schema.hasColumn("products", "our_share_cents"),
    knex.schema.hasColumn("products", "royalty_cents"),
    knex.schema.hasColumn("products", "merch_type"),
    knex.schema.hasColumn("products", "colors"),
    knex.schema.hasColumn("products", "listing_photos"),
    knex.schema.hasColumn("products", "is_active"),
  ]);

  await knex.schema.alterTable("products", (table) => {
    if (hasMerchStory) table.dropColumn("merch_story");
    if (hasMrpCents) table.dropColumn("mrp_cents");
    if (hasVendorPayoutCents) table.dropColumn("vendor_payout_cents");
    if (hasOurShareCents) table.dropColumn("our_share_cents");
    if (hasRoyaltyCents) table.dropColumn("royalty_cents");
    if (hasMerchType) table.dropColumn("merch_type");
    if (hasColors) table.dropColumn("colors");
    if (hasListingPhotos) table.dropColumn("listing_photos");
    if (hasIsActive) table.dropColumn("is_active");
  });
};
