exports.up = async (knex) => {
  const hasUsers = await knex.schema.hasTable("users");
  if (!hasUsers) return;

  await knex.schema.alterTable("users", (table) => {
    table.text("auth_provider").nullable();
    table.text("oidc_sub").nullable();
    table.text("avatar_url").nullable();
    table.boolean("email_verified").nullable();
  });

  await knex.schema.alterTable("users", (table) => {
    table.index(["auth_provider"], "users_auth_provider_idx");
    table.index(["oidc_sub"], "users_oidc_sub_idx");
  });
};

exports.down = async (knex) => {
  const hasUsers = await knex.schema.hasTable("users");
  if (!hasUsers) return;

  await knex.schema.alterTable("users", (table) => {
    table.dropIndex(["auth_provider"], "users_auth_provider_idx");
    table.dropIndex(["oidc_sub"], "users_oidc_sub_idx");
    table.dropColumn("email_verified");
    table.dropColumn("avatar_url");
    table.dropColumn("oidc_sub");
    table.dropColumn("auth_provider");
  });
};
