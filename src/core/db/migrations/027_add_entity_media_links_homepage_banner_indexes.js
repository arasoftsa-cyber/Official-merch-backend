exports.up = async (knex) => {
  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (!hasEntityMediaLinks) return;

  await knex.raw(`
    create index if not exists entity_media_links_entity_role_sort_idx
      on entity_media_links (entity_type, entity_id, role, sort_order)
  `);

  await knex.raw(`
    create index if not exists entity_media_links_media_asset_id_idx
      on entity_media_links (media_asset_id)
  `);
};

exports.down = async (knex) => {
  await knex.raw("drop index if exists entity_media_links_media_asset_id_idx");
  await knex.raw("drop index if exists entity_media_links_entity_role_sort_idx");
};
