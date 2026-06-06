exports.up = async (knex) => {
  await knex.schema.createTable("user_addresses", (table) => {
    table.uuid("id").primary();
    table
      .uuid("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.text("address_type").notNullable().defaultTo("home");
    table.text("full_name").notNullable();
    table.text("phone").notNullable();
    table.text("line1").notNullable();
    table.text("line2");
    table.text("landmark");
    table.text("city").notNullable();
    table.text("state").notNullable();
    table.text("postal_code").notNullable();
    table.text("country").notNullable().defaultTo("India");
    table.boolean("is_default").notNullable().defaultTo(false);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable("user_addresses", (table) => {
    table.index(["user_id", "created_at"]);
    table.index(["user_id", "is_default"]);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("user_addresses");
};
