exports.up = async (knex) => {
  const hasUsers = await knex.schema.hasTable("users");
  if (!hasUsers) return;

  const hasTokenColumn = await knex.schema.hasColumn("users", "password_reset_token_hash");
  const hasExpiryColumn = await knex.schema.hasColumn("users", "password_reset_expires_at");

  if (!hasTokenColumn || !hasExpiryColumn) {
    await knex.schema.alterTable("users", (table) => {
      if (!hasTokenColumn) table.text("password_reset_token_hash").nullable();
      if (!hasExpiryColumn) table.timestamp("password_reset_expires_at").nullable();
    });
  }

  await knex.schema.alterTable("users", (table) => {
    table.index(["password_reset_token_hash"], "users_password_reset_token_hash_idx");
    table.index(["password_reset_expires_at"], "users_password_reset_expires_at_idx");
  });
};

exports.down = async (knex) => {
  const hasUsers = await knex.schema.hasTable("users");
  if (!hasUsers) return;

  const hasTokenColumn = await knex.schema.hasColumn("users", "password_reset_token_hash");
  const hasExpiryColumn = await knex.schema.hasColumn("users", "password_reset_expires_at");

  await knex.schema.alterTable("users", (table) => {
    table.dropIndex(["password_reset_token_hash"], "users_password_reset_token_hash_idx");
    table.dropIndex(["password_reset_expires_at"], "users_password_reset_expires_at_idx");
    if (hasExpiryColumn) table.dropColumn("password_reset_expires_at");
    if (hasTokenColumn) table.dropColumn("password_reset_token_hash");
  });
};

