exports.up = async (knex) => {
  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (!hasEntityMediaLinks) return;

  await knex.raw(`
    alter table entity_media_links
    drop constraint if exists entity_media_links_role_check
  `);
  await knex.raw(`
    alter table entity_media_links
    add constraint entity_media_links_role_check
    check (role in ('cover', 'avatar', 'gallery', 'profile_photo', 'listing_photo', 'hero_carousel'))
  `);
};

exports.down = async (knex) => {
  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (!hasEntityMediaLinks) return;

  await knex.raw(`
    alter table entity_media_links
    drop constraint if exists entity_media_links_role_check
  `);
  await knex.raw(`
    alter table entity_media_links
    add constraint entity_media_links_role_check
    check (role in ('cover', 'avatar', 'gallery', 'profile_photo', 'listing_photo'))
  `);
};
