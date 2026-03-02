exports.up = async (knex) => {
  const hasTable = await knex.schema.hasTable("artist_access_requests");
  if (!hasTable) return;

  const hasHandle = await knex.schema.hasColumn("artist_access_requests", "handle");
  const hasEmail = await knex.schema.hasColumn("artist_access_requests", "email");
  const hasPhone = await knex.schema.hasColumn("artist_access_requests", "phone");
  const hasSocials = await knex.schema.hasColumn("artist_access_requests", "socials");
  const hasAboutMe = await knex.schema.hasColumn("artist_access_requests", "about_me");
  const hasMessageForFans = await knex.schema.hasColumn("artist_access_requests", "message_for_fans");
  const hasProfilePhotoPath = await knex.schema.hasColumn("artist_access_requests", "profile_photo_path");
  const hasRejectionComment = await knex.schema.hasColumn("artist_access_requests", "rejection_comment");
  const hasUpdatedAt = await knex.schema.hasColumn("artist_access_requests", "updated_at");

  await knex.schema.alterTable("artist_access_requests", (table) => {
    if (!hasHandle) table.text("handle");
    if (!hasEmail) table.text("email");
    if (!hasPhone) table.text("phone");
    if (!hasSocials) table.jsonb("socials");
    if (!hasAboutMe) table.text("about_me");
    if (!hasMessageForFans) table.text("message_for_fans");
    if (!hasProfilePhotoPath) table.text("profile_photo_path");
    if (!hasRejectionComment) table.text("rejection_comment");
    if (!hasUpdatedAt) table.timestamp("updated_at").defaultTo(knex.fn.now());
  });

  await knex.raw(`
    UPDATE artist_access_requests
    SET handle = COALESCE(
      NULLIF(trim(handle), ''),
      NULLIF(
        regexp_replace(lower(COALESCE(artist_name, 'artist')), '[^a-z0-9]+', '-', 'g'),
        ''
      ),
      'artist-' || substring(id::text, 1, 8)
    )
    WHERE handle IS NULL OR trim(handle) = ''
  `);

  await knex.raw(`
    UPDATE artist_access_requests
    SET email = COALESCE(NULLIF(trim(email), ''), NULLIF(trim(contact_email), ''))
    WHERE email IS NULL OR trim(email) = ''
  `);

  await knex.raw(`
    UPDATE artist_access_requests
    SET phone = COALESCE(NULLIF(trim(phone), ''), NULLIF(trim(contact_phone), ''))
    WHERE phone IS NULL OR trim(phone) = ''
  `);

  await knex.raw(`
    UPDATE artist_access_requests
    SET socials = CASE
      WHEN socials IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(socials) = 'array' THEN socials
      WHEN jsonb_typeof(socials) = 'object' THEN (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object('platform', key, 'profileLink', value)
          ),
          '[]'::jsonb
        )
        FROM jsonb_each_text(socials)
      )
      ELSE '[]'::jsonb
    END
  `);

  await knex.raw(`
    UPDATE artist_access_requests
    SET about_me = COALESCE(NULLIF(trim(about_me), ''), NULLIF(trim(pitch), ''))
    WHERE about_me IS NULL OR trim(about_me) = ''
  `);

  await knex.raw(`
    UPDATE artist_access_requests
    SET status = CASE
      WHEN status IS NULL OR trim(status) = '' THEN 'pending'
      WHEN lower(status) = 'denied' THEN 'rejected'
      WHEN lower(status) IN ('pending', 'approved', 'rejected') THEN lower(status)
      ELSE 'pending'
    END
  `);

  await knex.raw(`
    UPDATE artist_access_requests
    SET updated_at = COALESCE(updated_at, created_at, now())
    WHERE updated_at IS NULL
  `);

  await knex.raw(`
    WITH ranked AS (
      SELECT id, handle, row_number() OVER (PARTITION BY lower(handle) ORDER BY created_at, id) AS rn
      FROM artist_access_requests
    )
    UPDATE artist_access_requests aar
    SET handle = aar.handle || '-' || substring(aar.id::text, 1, 8)
    FROM ranked
    WHERE aar.id = ranked.id
      AND ranked.rn > 1
  `);

  await knex.raw(`
    WITH ranked AS (
      SELECT id, email, row_number() OVER (PARTITION BY lower(email) ORDER BY created_at, id) AS rn
      FROM artist_access_requests
    )
    UPDATE artist_access_requests aar
    SET email = split_part(aar.email, '@', 1) || '+' || substring(aar.id::text, 1, 8) || '@' || split_part(aar.email, '@', 2)
    FROM ranked
    WHERE aar.id = ranked.id
      AND ranked.rn > 1
      AND position('@' in aar.email) > 0
  `);

  await knex.raw(`
    WITH ranked AS (
      SELECT id, phone, row_number() OVER (PARTITION BY lower(phone) ORDER BY created_at, id) AS rn
      FROM artist_access_requests
    )
    UPDATE artist_access_requests aar
    SET phone = aar.phone || '-' || substring(aar.id::text, 1, 8)
    FROM ranked
    WHERE aar.id = ranked.id
      AND ranked.rn > 1
  `);

  await knex.raw(`
    ALTER TABLE artist_access_requests
    ALTER COLUMN handle SET NOT NULL,
    ALTER COLUMN email SET NOT NULL,
    ALTER COLUMN phone SET NOT NULL,
    ALTER COLUMN socials SET DEFAULT '[]'::jsonb,
    ALTER COLUMN socials SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'pending',
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE artist_access_requests
    DROP CONSTRAINT IF EXISTS artist_access_requests_status_check
  `);

  await knex.raw(`
    ALTER TABLE artist_access_requests
    ADD CONSTRAINT artist_access_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS artist_access_requests_handle_unique_idx
    ON artist_access_requests (lower(handle))
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS artist_access_requests_email_unique_idx
    ON artist_access_requests (lower(email))
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS artist_access_requests_phone_unique_idx
    ON artist_access_requests (lower(phone))
  `);
};

exports.down = async (knex) => {
  const hasTable = await knex.schema.hasTable("artist_access_requests");
  if (!hasTable) return;

  await knex.raw(`DROP INDEX IF EXISTS artist_access_requests_phone_unique_idx`);
  await knex.raw(`DROP INDEX IF EXISTS artist_access_requests_email_unique_idx`);
  await knex.raw(`DROP INDEX IF EXISTS artist_access_requests_handle_unique_idx`);
  await knex.raw(`
    ALTER TABLE artist_access_requests
    DROP CONSTRAINT IF EXISTS artist_access_requests_status_check
  `);
  await knex.raw(`
    ALTER TABLE artist_access_requests
    ADD CONSTRAINT artist_access_requests_status_check
    CHECK (status IN ('pending','approved','denied'))
  `);

  const hasProfilePhotoPath = await knex.schema.hasColumn("artist_access_requests", "profile_photo_path");
  const hasRejectionComment = await knex.schema.hasColumn("artist_access_requests", "rejection_comment");
  const hasUpdatedAt = await knex.schema.hasColumn("artist_access_requests", "updated_at");

  await knex.schema.alterTable("artist_access_requests", (table) => {
    if (hasProfilePhotoPath) table.dropColumn("profile_photo_path");
    if (hasRejectionComment) table.dropColumn("rejection_comment");
    if (hasUpdatedAt) table.dropColumn("updated_at");
  });
};
