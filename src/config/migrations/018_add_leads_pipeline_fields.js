exports.up = async (knex) => {
  const hasStatus = await knex.schema.hasColumn("leads", "status");
  if (!hasStatus) {
    await knex.schema.alterTable("leads", (table) => {
      table.text("status").notNullable().defaultTo("new");
    });
  }

  const hasAdminNote = await knex.schema.hasColumn("leads", "admin_note");
  if (!hasAdminNote) {
    await knex.schema.alterTable("leads", (table) => {
      table.text("admin_note").nullable();
    });
  }

  const hasUpdatedAt = await knex.schema.hasColumn("leads", "updated_at");
  if (!hasUpdatedAt) {
    await knex.schema.alterTable("leads", (table) => {
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  await knex("leads")
    .whereNull("status")
    .update({ status: "new" });
};

exports.down = async (knex) => {
  const hasUpdatedAt = await knex.schema.hasColumn("leads", "updated_at");
  if (hasUpdatedAt) {
    await knex.schema.alterTable("leads", (table) => {
      table.dropColumn("updated_at");
    });
  }

  const hasAdminNote = await knex.schema.hasColumn("leads", "admin_note");
  if (hasAdminNote) {
    await knex.schema.alterTable("leads", (table) => {
      table.dropColumn("admin_note");
    });
  }

  const hasStatus = await knex.schema.hasColumn("leads", "status");
  if (hasStatus) {
    await knex.schema.alterTable("leads", (table) => {
      table.dropColumn("status");
    });
  }
};

