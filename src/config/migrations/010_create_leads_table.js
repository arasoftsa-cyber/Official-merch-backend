exports.up = async (knex) => {
  await knex.schema.createTable("leads", (table) => {
    table.uuid("id").primary();
    table.text("source");
    table.text("drop_handle");
    table.text("artist_handle");
    table.text("name");
    table.text("phone");
    table.text("email");
    table.jsonb("answers_json");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("leads");
};
