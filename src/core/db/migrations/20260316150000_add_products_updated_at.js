exports.up = async (knex) => {
  const hasProducts = await knex.schema.hasTable("products");
  if (!hasProducts) return;

  const hasUpdatedAt = await knex.schema.hasColumn("products", "updated_at");
  if (!hasUpdatedAt) {
    await knex.schema.alterTable("products", (table) => {
      table.timestamp("updated_at", { useTz: true });
    });
  }

  await knex.raw(`
    update products
       set updated_at = coalesce(updated_at, created_at, now())
     where updated_at is null
  `);

  await knex.raw(`
    alter table products
    alter column updated_at set default now(),
    alter column updated_at set not null
  `);
};

exports.down = async (knex) => {
  const hasProducts = await knex.schema.hasTable("products");
  if (!hasProducts) return;

  const hasUpdatedAt = await knex.schema.hasColumn("products", "updated_at");
  if (!hasUpdatedAt) return;

  await knex.schema.alterTable("products", (table) => {
    table.dropColumn("updated_at");
  });
};
