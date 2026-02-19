exports.up = async (knex) => {
  const hasColumn = await knex.schema.hasColumn(
    "artist_access_requests",
    "requestor_user_id"
  );

  if (!hasColumn) {
    await knex.schema.alterTable("artist_access_requests", (table) => {
      table.uuid("requestor_user_id").nullable();
    });
  }

  await knex.raw(`
    update artist_access_requests as aar
    set requestor_user_id = u.id
    from users as u
    where aar.requestor_user_id is null
      and aar.contact_email is not null
      and lower(trim(aar.contact_email)) = lower(trim(u.email))
  `);

  await knex.raw(`
    alter table artist_access_requests
    drop constraint if exists fk_artist_access_requests_requestor_user
  `);

  await knex.raw(`
    alter table artist_access_requests
    add constraint fk_artist_access_requests_requestor_user
    foreign key (requestor_user_id) references users(id) on delete set null
  `);

  await knex.raw(`
    create index if not exists artist_access_requests_requestor_user_id_idx
    on artist_access_requests (requestor_user_id)
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    alter table artist_access_requests
    drop constraint if exists fk_artist_access_requests_requestor_user
  `);

  await knex.raw(`
    drop index if exists artist_access_requests_requestor_user_id_idx
  `);

  const hasColumn = await knex.schema.hasColumn(
    "artist_access_requests",
    "requestor_user_id"
  );

  if (hasColumn) {
    await knex.schema.alterTable("artist_access_requests", (table) => {
      table.dropColumn("requestor_user_id");
    });
  }
};
