exports.up = async (knex) => {
  const hasTable = await knex.schema.hasTable("artist_access_requests");
  if (!hasTable) return;

  const hasEmail = await knex.schema.hasColumn("artist_access_requests", "email");
  const hasPhone = await knex.schema.hasColumn("artist_access_requests", "phone");
  const hasAboutMe = await knex.schema.hasColumn("artist_access_requests", "about_me");
  const hasProfilePhotoUrl = await knex.schema.hasColumn(
    "artist_access_requests",
    "profile_photo_url"
  );
  const hasMessageForFans = await knex.schema.hasColumn(
    "artist_access_requests",
    "message_for_fans"
  );

  if (!hasEmail || !hasPhone || !hasAboutMe || !hasProfilePhotoUrl || !hasMessageForFans) {
    await knex.schema.alterTable("artist_access_requests", (table) => {
      if (!hasEmail) table.string("email");
      if (!hasPhone) table.string("phone");
      if (!hasAboutMe) table.text("about_me");
      if (!hasProfilePhotoUrl) table.string("profile_photo_url");
      if (!hasMessageForFans) table.text("message_for_fans");
    });
  }

  await knex.raw(`
    UPDATE artist_access_requests
    SET email = COALESCE(NULLIF(email, ''), contact_email)
    WHERE email IS NULL OR email = ''
  `);
  await knex.raw(`
    UPDATE artist_access_requests
    SET phone = COALESCE(NULLIF(phone, ''), contact_phone)
    WHERE phone IS NULL OR phone = ''
  `);
  await knex.raw(`
    UPDATE artist_access_requests
    SET about_me = COALESCE(NULLIF(about_me, ''), pitch)
    WHERE about_me IS NULL OR about_me = ''
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS artist_access_requests_email_idx
    ON artist_access_requests (lower(email))
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS artist_access_requests_phone_idx
    ON artist_access_requests (phone)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS artist_access_requests_handle_idx
    ON artist_access_requests (lower(handle))
  `);
};

exports.down = async (knex) => {
  const hasTable = await knex.schema.hasTable("artist_access_requests");
  if (!hasTable) return;

  await knex.raw(`DROP INDEX IF EXISTS artist_access_requests_email_idx`);
  await knex.raw(`DROP INDEX IF EXISTS artist_access_requests_phone_idx`);
  await knex.raw(`DROP INDEX IF EXISTS artist_access_requests_handle_idx`);

  await knex.schema.alterTable("artist_access_requests", (table) => {
    table.dropColumn("email");
    table.dropColumn("phone");
    table.dropColumn("about_me");
    table.dropColumn("profile_photo_url");
    table.dropColumn("message_for_fans");
  });
};
