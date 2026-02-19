exports.up = async (knex) => {
  await knex.schema.createTable("products", (table) => {
    table.uuid("id").primary();
    table
      .uuid("artist_id")
      .notNullable()
      .references("id")
      .inTable("artists")
      .onDelete("CASCADE");
    table.text("title").notNullable();
    table.text("description").nullable();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["artist_id"]);
    table.index(["is_active"]);
  });

  await knex.schema.createTable("product_variants", (table) => {
    table.uuid("id").primary();
    table
      .uuid("product_id")
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("CASCADE");
    table.text("sku").notNullable().unique();
    table.text("size").notNullable();
    table.text("color").notNullable();
    table.integer("price_cents").notNullable();
    table.integer("stock").notNullable().defaultTo(0);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["product_id"]);
    table.index(["sku"]);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("product_variants");
  await knex.schema.dropTableIfExists("products");
};
