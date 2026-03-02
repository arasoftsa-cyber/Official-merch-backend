exports.up = async (knex) => {
  await knex.schema.createTable("artist_access_requests", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("artist_name").notNullable();
    table.string("handle");
    table.string("contact_email").notNullable();
    table.string("contact_phone");
    table.jsonb("socials");
    table.text("pitch");
    table
      .string("status")
      .notNullable()
      .defaultTo("pending");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("decided_at");
    table
      .uuid("decided_by_user_id")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.index(["status"], "artist_access_requests_status_idx");
    table.index(["created_at"], "artist_access_requests_created_at_idx");
  });

  await knex.raw(`
    ALTER TABLE artist_access_requests
    ADD CONSTRAINT artist_access_requests_status_check
    CHECK (status IN ('pending','approved','denied'))
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("artist_access_requests");
};
