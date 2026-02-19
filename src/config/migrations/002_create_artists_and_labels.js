exports.up = async (knex) => {
  await knex.schema.createTable("artists", (table) => {
    table.uuid("id").primary();
    table.text("handle").notNullable().unique();
    table.text("name").notNullable();
    table
      .jsonb("theme_json")
      .notNullable()
      .defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["handle"]);
  });

  await knex.schema.createTable("labels", (table) => {
    table.uuid("id").primary();
    table.text("handle").notNullable().unique();
    table.text("name").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["handle"]);
  });

  await knex.schema.alterTable("label_artist_map", (table) => {
    table
      .foreign("label_id")
      .references("id")
      .inTable("labels")
      .onDelete("CASCADE");
    table
      .foreign("artist_id")
      .references("id")
      .inTable("artists")
      .onDelete("CASCADE");
  });

  await knex.schema.alterTable("artist_user_map", (table) => {
    table
      .foreign("artist_id")
      .references("id")
      .inTable("artists")
      .onDelete("CASCADE");
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable("artist_user_map", (table) => {
    table.dropForeign(["artist_id"]);
  });

  await knex.schema.alterTable("label_artist_map", (table) => {
    table.dropForeign(["label_id"]);
    table.dropForeign(["artist_id"]);
  });

  await knex.schema.dropTableIfExists("labels");
  await knex.schema.dropTableIfExists("artists");
};
