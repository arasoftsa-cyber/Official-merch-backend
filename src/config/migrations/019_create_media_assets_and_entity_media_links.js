exports.up = async (knex) => {
  await knex.raw('create extension if not exists "pgcrypto"');

  const hasMediaAssets = await knex.schema.hasTable("media_assets");
  if (!hasMediaAssets) {
    await knex.schema.createTable("media_assets", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table.text("public_url").notNullable();
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  await knex.raw(
    "create unique index if not exists media_assets_public_url_unique on media_assets (public_url)"
  );

  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (!hasEntityMediaLinks) {
    await knex.schema.createTable("entity_media_links", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table
        .uuid("media_asset_id")
        .notNullable()
        .references("id")
        .inTable("media_assets")
        .onDelete("CASCADE");
      table.text("entity_type").notNullable();
      table.uuid("entity_id").notNullable();
      table.text("role").notNullable();
      table.integer("sort_order").notNullable().defaultTo(0);
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  await knex.raw(`
    alter table entity_media_links
    drop constraint if exists entity_media_links_entity_type_check
  `);
  await knex.raw(`
    alter table entity_media_links
    add constraint entity_media_links_entity_type_check
    check (entity_type in ('artist', 'drop', 'product'))
  `);

  await knex.raw(`
    alter table entity_media_links
    drop constraint if exists entity_media_links_role_check
  `);
  await knex.raw(`
    alter table entity_media_links
    add constraint entity_media_links_role_check
    check (role in ('cover', 'avatar', 'gallery'))
  `);

  await knex.raw(`
    create unique index if not exists entity_media_links_cover_unique
      on entity_media_links (entity_type, entity_id)
      where role = 'cover'
  `);
  await knex.raw(`
    create unique index if not exists entity_media_links_avatar_unique
      on entity_media_links (entity_type, entity_id)
      where role = 'avatar'
  `);
  await knex.raw(`
    create unique index if not exists entity_media_links_gallery_sort_unique
      on entity_media_links (entity_type, entity_id, sort_order)
      where role = 'gallery'
  `);
};

exports.down = async (knex) => {
  await knex.raw("drop index if exists entity_media_links_gallery_sort_unique");
  await knex.raw("drop index if exists entity_media_links_avatar_unique");
  await knex.raw("drop index if exists entity_media_links_cover_unique");
  await knex.raw("drop index if exists media_assets_public_url_unique");

  await knex.schema.dropTableIfExists("entity_media_links");
  await knex.schema.dropTableIfExists("media_assets");
};
