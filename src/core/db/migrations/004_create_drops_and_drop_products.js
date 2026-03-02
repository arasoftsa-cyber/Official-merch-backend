exports.up = async (knex) => {
  await knex.schema.createTable("drops", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("handle").notNullable().unique();
    table.string("title").notNullable();
    table.text("description").nullable();
    table.text("hero_image_url").nullable();
    table
      .string("status")
      .notNullable()
      .defaultTo("draft");
    table.timestamp("starts_at").nullable();
    table.timestamp("ends_at").nullable();
    table
      .uuid("artist_id")
      .nullable()
      .references("id")
      .inTable("artists")
      .onDelete("SET NULL");
    table
      .uuid("label_id")
      .nullable()
      .references("id")
      .inTable("labels")
      .onDelete("SET NULL");
    table
      .uuid("created_by_user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(`
    ALTER TABLE drops
    ADD CONSTRAINT drops_status_check
    CHECK (status IN ('draft', 'published', 'archived'))
  `);

  await knex.schema.raw(`
    ALTER TABLE drops
    ADD CONSTRAINT drops_owner_check
    CHECK (
      (artist_id IS NOT NULL AND label_id IS NULL)
      OR (artist_id IS NULL AND label_id IS NOT NULL)
    )
  `);

  await knex.schema.createTable("drop_products", (table) => {
    table.uuid("drop_id").notNullable().references("id").inTable("drops").onDelete("CASCADE");
    table.uuid("product_id").notNullable().references("id").inTable("products").onDelete("CASCADE");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.primary(["drop_id", "product_id"]);
    table.index("drop_id");
    table.index("product_id");
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("drop_products");
  await knex.schema.dropTableIfExists("drops");
};
