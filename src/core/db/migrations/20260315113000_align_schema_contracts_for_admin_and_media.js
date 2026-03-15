exports.up = async (knex) => {
  const hasArtists = await knex.schema.hasTable("artists");
  if (hasArtists) {
    const [
      hasEmail,
      hasStatus,
      hasPhone,
      hasAboutMe,
      hasMessageForFans,
      hasSocials,
      hasProfilePhotoUrl,
    ] = await Promise.all([
      knex.schema.hasColumn("artists", "email"),
      knex.schema.hasColumn("artists", "status"),
      knex.schema.hasColumn("artists", "phone"),
      knex.schema.hasColumn("artists", "about_me"),
      knex.schema.hasColumn("artists", "message_for_fans"),
      knex.schema.hasColumn("artists", "socials"),
      knex.schema.hasColumn("artists", "profile_photo_url"),
    ]);

    await knex.schema.alterTable("artists", (table) => {
      if (!hasEmail) table.text("email");
      if (!hasStatus) table.text("status").notNullable().defaultTo("active");
      if (!hasPhone) table.text("phone");
      if (!hasAboutMe) table.text("about_me");
      if (!hasMessageForFans) table.text("message_for_fans");
      if (!hasSocials) table.jsonb("socials").notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      if (!hasProfilePhotoUrl) table.text("profile_photo_url");
    });

    await knex.raw(`
      update artists
         set status = coalesce(nullif(trim(status), ''), 'active')
       where status is null or trim(status) = ''
    `);

    await knex.raw(`
      update artists
         set socials = '[]'::jsonb
       where socials is null
    `);

    await knex.raw(`
      update artists a
         set email = coalesce(nullif(trim(a.email), ''), nullif(trim(u.email), ''))
        from artist_user_map aum
        join users u on u.id = aum.user_id
       where a.id = aum.artist_id
         and (a.email is null or trim(a.email) = '')
    `);

    await knex.raw(`
      with latest_requests as (
        select distinct on (lower(handle))
          lower(handle) as handle_key,
          phone,
          about_me,
          message_for_fans,
          socials,
          profile_photo_url,
          status
        from artist_access_requests
        where handle is not null and trim(handle) <> ''
        order by lower(handle), created_at desc, id desc
      )
      update artists a
         set phone = coalesce(nullif(trim(a.phone), ''), nullif(trim(r.phone), '')),
             about_me = coalesce(nullif(trim(a.about_me), ''), nullif(trim(r.about_me), '')),
             message_for_fans = coalesce(nullif(trim(a.message_for_fans), ''), nullif(trim(r.message_for_fans), '')),
             socials = case
               when a.socials is null or a.socials = '[]'::jsonb then coalesce(r.socials, '[]'::jsonb)
               else a.socials
             end,
             profile_photo_url = coalesce(nullif(trim(a.profile_photo_url), ''), nullif(trim(r.profile_photo_url), '')),
             status = coalesce(nullif(trim(a.status), ''), nullif(trim(r.status), ''), 'active')
        from latest_requests r
       where lower(a.handle) = r.handle_key
    `);

    await knex.raw(`
      alter table artists
      alter column status set default 'active',
      alter column status set not null,
      alter column socials set default '[]'::jsonb,
      alter column socials set not null
    `);
  }

  const hasMediaAssets = await knex.schema.hasTable("media_assets");
  if (hasMediaAssets) {
    const [
      hasStatus,
      hasStorageKey,
      hasProvider,
      hasMimeType,
      hasSizeBytes,
      hasOriginalFilename,
    ] = await Promise.all([
      knex.schema.hasColumn("media_assets", "status"),
      knex.schema.hasColumn("media_assets", "storage_key"),
      knex.schema.hasColumn("media_assets", "provider"),
      knex.schema.hasColumn("media_assets", "mime_type"),
      knex.schema.hasColumn("media_assets", "size_bytes"),
      knex.schema.hasColumn("media_assets", "original_filename"),
    ]);

    await knex.schema.alterTable("media_assets", (table) => {
      if (!hasStatus) table.text("status").notNullable().defaultTo("available");
      if (!hasStorageKey) table.text("storage_key");
      if (!hasProvider) table.text("provider");
      if (!hasMimeType) table.text("mime_type");
      if (!hasSizeBytes) table.bigInteger("size_bytes");
      if (!hasOriginalFilename) table.text("original_filename");
    });

    await knex.raw(`
      update media_assets
         set status = coalesce(nullif(trim(status), ''), 'available')
       where status is null or trim(status) = ''
    `);

    await knex.raw(`
      alter table media_assets
      alter column status set default 'available',
      alter column status set not null
    `);

    await knex.raw(`
      alter table media_assets
      drop constraint if exists media_assets_status_check
    `);
    await knex.raw(`
      alter table media_assets
      add constraint media_assets_status_check
      check (status in ('pending', 'available', 'rejected', 'failed'))
    `);
  }
};

exports.down = async (knex) => {
  const hasMediaAssets = await knex.schema.hasTable("media_assets");
  if (hasMediaAssets) {
    await knex.raw(`
      alter table media_assets
      drop constraint if exists media_assets_status_check
    `);

    const [
      hasStatus,
      hasStorageKey,
      hasProvider,
      hasMimeType,
      hasSizeBytes,
      hasOriginalFilename,
    ] = await Promise.all([
      knex.schema.hasColumn("media_assets", "status"),
      knex.schema.hasColumn("media_assets", "storage_key"),
      knex.schema.hasColumn("media_assets", "provider"),
      knex.schema.hasColumn("media_assets", "mime_type"),
      knex.schema.hasColumn("media_assets", "size_bytes"),
      knex.schema.hasColumn("media_assets", "original_filename"),
    ]);

    await knex.schema.alterTable("media_assets", (table) => {
      if (hasOriginalFilename) table.dropColumn("original_filename");
      if (hasSizeBytes) table.dropColumn("size_bytes");
      if (hasMimeType) table.dropColumn("mime_type");
      if (hasProvider) table.dropColumn("provider");
      if (hasStorageKey) table.dropColumn("storage_key");
      if (hasStatus) table.dropColumn("status");
    });
  }

  const hasArtists = await knex.schema.hasTable("artists");
  if (!hasArtists) return;

  const [
    hasEmail,
    hasStatus,
    hasPhone,
    hasAboutMe,
    hasMessageForFans,
    hasSocials,
    hasProfilePhotoUrl,
  ] = await Promise.all([
    knex.schema.hasColumn("artists", "email"),
    knex.schema.hasColumn("artists", "status"),
    knex.schema.hasColumn("artists", "phone"),
    knex.schema.hasColumn("artists", "about_me"),
    knex.schema.hasColumn("artists", "message_for_fans"),
    knex.schema.hasColumn("artists", "socials"),
    knex.schema.hasColumn("artists", "profile_photo_url"),
  ]);

  await knex.schema.alterTable("artists", (table) => {
    if (hasProfilePhotoUrl) table.dropColumn("profile_photo_url");
    if (hasSocials) table.dropColumn("socials");
    if (hasMessageForFans) table.dropColumn("message_for_fans");
    if (hasAboutMe) table.dropColumn("about_me");
    if (hasPhone) table.dropColumn("phone");
    if (hasStatus) table.dropColumn("status");
    if (hasEmail) table.dropColumn("email");
  });
};
