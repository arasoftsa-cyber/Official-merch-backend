exports.up = async (knex) => {
  const hasTable = await knex.schema.hasTable("artist_access_requests");
  if (!hasTable) return;

  await knex.raw(`
    alter table artist_access_requests
    drop constraint if exists fk_artist_access_requests_label
  `);

  await knex.raw(`
    drop index if exists artist_access_requests_label_id_idx
  `);

  const hasLabelId = await knex.schema.hasColumn("artist_access_requests", "label_id");
  if (!hasLabelId) return;

  await knex.schema.alterTable("artist_access_requests", (table) => {
    table.dropColumn("label_id");
  });
};

exports.down = async (knex) => {
  const hasTable = await knex.schema.hasTable("artist_access_requests");
  if (!hasTable) return;

  const hasLabelId = await knex.schema.hasColumn("artist_access_requests", "label_id");
  if (!hasLabelId) {
    await knex.schema.alterTable("artist_access_requests", (table) => {
      table.uuid("label_id").nullable();
    });
  }

  await knex.raw(`
    update artist_access_requests as aar
       set label_id = lum.label_id
      from label_users_map as lum
     where aar.requestor_user_id is not null
       and lum.user_id = aar.requestor_user_id
  `);

  await knex.raw(`
    alter table artist_access_requests
    drop constraint if exists fk_artist_access_requests_label
  `);

  await knex.raw(`
    alter table artist_access_requests
    add constraint fk_artist_access_requests_label
    foreign key (label_id) references labels(id) on delete set null
  `);

  await knex.raw(`
    create index if not exists artist_access_requests_label_id_idx
    on artist_access_requests (label_id)
  `);
};
