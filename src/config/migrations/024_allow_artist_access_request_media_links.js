exports.up = async (knex) => {
  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (!hasEntityMediaLinks) return;

  await knex.raw(`
    alter table entity_media_links
    drop constraint if exists entity_media_links_entity_type_check
  `);
  await knex.raw(`
    alter table entity_media_links
    add constraint entity_media_links_entity_type_check
    check (entity_type in ('artist', 'drop', 'product', 'artist_access_request'))
  `);

  await knex.raw(`
    alter table entity_media_links
    drop constraint if exists entity_media_links_role_check
  `);
  await knex.raw(`
    alter table entity_media_links
    add constraint entity_media_links_role_check
    check (role in ('cover', 'avatar', 'gallery', 'profile_photo'))
  `);
};

exports.down = async (knex) => {
  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (!hasEntityMediaLinks) return;

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
};
