exports.up = async (knex) => {
  // Add delivery_address column to orders table as JSONB
  await knex.schema.alterTable("orders", (table) => {
    table.jsonb("delivery_address").nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("delivery_address");
  });
};
