exports.up = async (knex) => {
  await knex.schema.createTable("payments", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("order_id")
      .notNullable()
      .unique()
      .references("id")
      .inTable("orders")
      .onDelete("CASCADE");
    table
      .text("status")
      .notNullable()
      .defaultTo("unpaid");
    table.text("provider").notNullable().defaultTo("mock");
    table.integer("amount_cents").notNullable();
    table.text("currency").notNullable().defaultTo("INR");
    table.text("provider_payment_id");
    table
      .specificType("created_at", "timestamptz")
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .specificType("updated_at", "timestamptz")
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE payments
    ADD CONSTRAINT payments_status_check
    CHECK (status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded'))
  `);

  await knex.schema.table("payments", (table) => {
    table.index("status");
  });

  await knex.schema.createTable("payment_attempts", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("payment_id")
      .notNullable()
      .references("id")
      .inTable("payments")
      .onDelete("CASCADE");
    table.text("status").notNullable();
    table.text("provider").notNullable();
    table.text("provider_attempt_id");
    table.jsonb("meta_json");
    table
      .specificType("created_at", "timestamptz")
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE payment_attempts
    ADD CONSTRAINT payment_attempts_status_check
    CHECK (status IN ('created', 'succeeded', 'failed'))
  `);

  await knex.schema.table("payment_attempts", (table) => {
    table.index("payment_id");
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("payment_attempts");
  await knex.schema.dropTableIfExists("payments");
};
