/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn("drops", "hero_image_url");
  if (hasColumn) {
    await knex.schema.table("drops", (table) => {
      table.dropColumn("hero_image_url");
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn("drops", "hero_image_url");
  if (!hasColumn) {
    await knex.schema.table("drops", (table) => {
      table.text("hero_image_url").nullable();
    });
  }
};
