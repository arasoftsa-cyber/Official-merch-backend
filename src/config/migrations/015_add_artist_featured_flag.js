exports.up = async (knex) => {
  const exists = await knex.schema.hasColumn("artists", "is_featured");
  if (!exists) {
    await knex.schema.alterTable("artists", (table) => {
      table.boolean("is_featured").notNullable().defaultTo(false);
    });
  }
};

exports.down = async (knex) => {
  const exists = await knex.schema.hasColumn("artists", "is_featured");
  if (exists) {
    await knex.schema.alterTable("artists", (table) => {
      table.dropColumn("is_featured");
    });
  }
};
