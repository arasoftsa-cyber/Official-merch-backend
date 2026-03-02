exports.up = async (knex) => {
  await knex.schema.createTable("payment_events", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("payment_id")
      .references("id")
      .inTable("payments")
      .onDelete("CASCADE");
    table.text("event_type").notNullable();
    table.text("provider").notNullable();
    table.text("provider_event_id");
    table.jsonb("payload_json");
    table
      .specificType("created_at", "timestamptz")
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.schema.table("payment_events", (table) => {
    table.index("payment_id");
    table.index(["provider", "provider_event_id"]);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("payment_events");
};
