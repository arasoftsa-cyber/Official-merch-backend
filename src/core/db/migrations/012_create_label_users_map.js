exports.up = async (knex) => {
  await knex.raw('create extension if not exists "pgcrypto"');

  await knex.schema.createTable("label_users_map", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .uuid("label_id")
      .notNullable()
      .references("id")
      .inTable("labels")
      .onDelete("CASCADE");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(["user_id"]);
    table.index("user_id");
    table.index("label_id");
  });

};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("label_users_map");
};
