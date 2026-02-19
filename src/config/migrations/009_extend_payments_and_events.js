exports.up = async (knex) => {
  await knex.schema.alterTable("payments", (table) => {
    table.text("provider_order_id");
    table.text("provider_signature");
    table.specificType("paid_at", "timestamptz");
  });

  await knex.raw(`
    CREATE UNIQUE INDEX payment_events_provider_event_unique
    ON payment_events(provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    DROP INDEX IF EXISTS payment_events_provider_event_unique
  `);

  await knex.schema.alterTable("payments", (table) => {
    table.dropColumn("provider_order_id");
    table.dropColumn("provider_signature");
    table.dropColumn("paid_at");
  });
};
