exports.up = async (knex) => {
  await knex.schema.createTable("users", (table) => {
    table.uuid("id").primary();
    table.text("email").notNullable().unique();
    table.text("password_hash").notNullable();
    table.text("role").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("artist_user_map", (table) => {
    table.uuid("id").primary();
    table.uuid("artist_id").notNullable();
    table
      .uuid("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.unique(["artist_id", "user_id"]);
  });

  await knex.schema.createTable("label_artist_map", (table) => {
    table.uuid("id").primary();
    table.uuid("label_id").notNullable();
    table.uuid("artist_id").notNullable();
    table.unique(["label_id", "artist_id"]);
  });

  await knex.schema.alterTable("artist_user_map", (table) => {
    table.index("user_id");
  });

  await knex.schema.alterTable("label_artist_map", (table) => {
    table.index("label_id");
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("label_artist_map");
  await knex.schema.dropTableIfExists("artist_user_map");
  await knex.schema.dropTableIfExists("users");
};
