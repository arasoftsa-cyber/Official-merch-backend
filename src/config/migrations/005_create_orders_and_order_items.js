exports.up = async (knex) => {
  await knex.schema.createTable("orders", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("buyer_user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .string("status")
      .notNullable()
      .defaultTo("placed");
    table.integer("total_cents").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE orders
    ADD CONSTRAINT orders_status_check
    CHECK (status IN ('placed', 'cancelled', 'fulfilled'))
  `);

  await knex.schema.createTable("order_items", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("order_id")
      .notNullable()
      .references("id")
      .inTable("orders")
      .onDelete("CASCADE");
    table
      .uuid("product_id")
      .notNullable()
      .references("id")
      .inTable("products");
    table
      .uuid("product_variant_id")
      .notNullable()
      .references("id")
      .inTable("product_variants");
    table.integer("quantity").notNullable();
    table.integer("price_cents").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index("order_id");
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("order_items");
  await knex.schema.dropTableIfExists("orders");
};
