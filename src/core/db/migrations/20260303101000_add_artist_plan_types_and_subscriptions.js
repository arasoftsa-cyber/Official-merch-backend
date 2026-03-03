exports.up = async (knex) => {
  await knex.raw('create extension if not exists "pgcrypto"');

  const hasArtistAccessRequests = await knex.schema.hasTable("artist_access_requests");
  if (hasArtistAccessRequests) {
    const hasRequestedPlanType = await knex.schema.hasColumn(
      "artist_access_requests",
      "requested_plan_type"
    );
    const hasApprovedPlanType = await knex.schema.hasColumn(
      "artist_access_requests",
      "approved_plan_type"
    );

    await knex.schema.alterTable("artist_access_requests", (table) => {
      if (!hasRequestedPlanType) {
        table.text("requested_plan_type").notNullable().defaultTo("basic");
      }
      if (!hasApprovedPlanType) {
        table.text("approved_plan_type").nullable();
      }
    });

    await knex.raw(`
      update artist_access_requests
      set requested_plan_type = 'basic'
      where requested_plan_type is null or trim(requested_plan_type) = ''
    `);

    await knex.raw(`
      alter table artist_access_requests
      alter column requested_plan_type set default 'basic',
      alter column requested_plan_type set not null
    `);

    await knex.raw(`
      alter table artist_access_requests
      drop constraint if exists artist_access_requests_requested_plan_type_check
    `);
    await knex.raw(`
      alter table artist_access_requests
      add constraint artist_access_requests_requested_plan_type_check
      check (requested_plan_type in ('basic', 'advanced', 'premium'))
    `);

    await knex.raw(`
      alter table artist_access_requests
      drop constraint if exists artist_access_requests_approved_plan_type_check
    `);
    await knex.raw(`
      alter table artist_access_requests
      add constraint artist_access_requests_approved_plan_type_check
      check (
        approved_plan_type is null
        or approved_plan_type in ('basic', 'advanced', 'premium')
      )
    `);
  }

  const hasArtistSubscriptions = await knex.schema.hasTable("artist_subscriptions");
  if (!hasArtistSubscriptions) {
    await knex.schema.createTable("artist_subscriptions", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table
        .uuid("artist_id")
        .notNullable()
        .references("id")
        .inTable("artists")
        .onDelete("CASCADE");
      table.text("requested_plan_type").notNullable();
      table.text("approved_plan_type").notNullable();
      table.date("start_date").notNullable();
      table.date("end_date").notNullable();
      table.text("payment_mode").notNullable().defaultTo("NA");
      table.text("transaction_id").notNullable().defaultTo("NA");
      table
        .uuid("approved_by_admin_id")
        .nullable()
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
      table.timestamp("approved_at").notNullable().defaultTo(knex.fn.now());
      table.text("status").notNullable().defaultTo("active");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    });
  }

  await knex.raw(`
    alter table artist_subscriptions
    drop constraint if exists artist_subscriptions_requested_plan_type_check
  `);
  await knex.raw(`
    alter table artist_subscriptions
    add constraint artist_subscriptions_requested_plan_type_check
    check (requested_plan_type in ('basic', 'advanced', 'premium'))
  `);

  await knex.raw(`
    alter table artist_subscriptions
    drop constraint if exists artist_subscriptions_approved_plan_type_check
  `);
  await knex.raw(`
    alter table artist_subscriptions
    add constraint artist_subscriptions_approved_plan_type_check
    check (approved_plan_type in ('basic', 'advanced', 'premium'))
  `);

  await knex.raw(`
    alter table artist_subscriptions
    drop constraint if exists artist_subscriptions_status_check
  `);
  await knex.raw(`
    alter table artist_subscriptions
    add constraint artist_subscriptions_status_check
    check (status in ('active', 'expired', 'cancelled'))
  `);

  await knex.raw(`
    create unique index if not exists artist_subscriptions_one_active_per_artist_unique
      on artist_subscriptions (artist_id)
      where status = 'active'
  `);

  await knex.raw(`
    create index if not exists artist_subscriptions_artist_id_status_idx
      on artist_subscriptions (artist_id, status)
  `);
};

exports.down = async (knex) => {
  const hasArtistSubscriptions = await knex.schema.hasTable("artist_subscriptions");
  if (hasArtistSubscriptions) {
    await knex.raw(`
      drop index if exists artist_subscriptions_artist_id_status_idx
    `);
    await knex.raw(`
      drop index if exists artist_subscriptions_one_active_per_artist_unique
    `);
    await knex.schema.dropTableIfExists("artist_subscriptions");
  }

  const hasArtistAccessRequests = await knex.schema.hasTable("artist_access_requests");
  if (!hasArtistAccessRequests) return;

  await knex.raw(`
    alter table artist_access_requests
    drop constraint if exists artist_access_requests_approved_plan_type_check
  `);
  await knex.raw(`
    alter table artist_access_requests
    drop constraint if exists artist_access_requests_requested_plan_type_check
  `);

  const hasApprovedPlanType = await knex.schema.hasColumn(
    "artist_access_requests",
    "approved_plan_type"
  );
  const hasRequestedPlanType = await knex.schema.hasColumn(
    "artist_access_requests",
    "requested_plan_type"
  );

  await knex.schema.alterTable("artist_access_requests", (table) => {
    if (hasApprovedPlanType) {
      table.dropColumn("approved_plan_type");
    }
    if (hasRequestedPlanType) {
      table.dropColumn("requested_plan_type");
    }
  });
};
