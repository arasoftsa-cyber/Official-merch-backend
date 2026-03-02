exports.up = async (knex) => {
  const hasTable = await knex.schema.hasTable("auth_refresh_tokens");
  if (hasTable) return;

  await knex.schema.createTable("auth_refresh_tokens", (table) => {
    table
      .uuid("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("token_hash", 128).notNullable().unique();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("expires_at").notNullable();
    table.timestamp("revoked_at").nullable();
    table.index(["user_id", "expires_at"], "auth_refresh_tokens_user_exp_idx");
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("auth_refresh_tokens");
};
