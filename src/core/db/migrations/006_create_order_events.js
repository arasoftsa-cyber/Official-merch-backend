exports.up = async (knex) => {
  await knex.schema.createTable("order_events", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("order_id")
      .notNullable()
      .references("id")
      .inTable("orders")
      .onDelete("CASCADE");
    table
      .string("type")
      .notNullable();
    table
      .uuid("actor_user_id")
      .notNullable()
      .references("id")
      .inTable("users");
    table.text("note").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index("order_id");
    table.index("actor_user_id");
  });

  await knex.raw(`
    ALTER TABLE order_events
    ADD CONSTRAINT order_events_type_check
    CHECK (type IN ('placed', 'cancelled', 'fulfilled'))
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("order_events");
};
