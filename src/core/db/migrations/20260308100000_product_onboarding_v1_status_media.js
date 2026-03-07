const hasConstraint = async (knex, tableName, constraintName) => {
  const row = await knex("pg_constraint as c")
    .join("pg_class as t", "t.oid", "c.conrelid")
    .join("pg_namespace as n", "n.oid", "t.relnamespace")
    .where("n.nspname", "public")
    .andWhere("t.relname", tableName)
    .andWhere("c.conname", constraintName)
    .first("c.conname");
  return Boolean(row);
};

exports.up = async (knex) => {
  const hasProducts = await knex.schema.hasTable("products");
  if (hasProducts) {
    const [hasStatus, hasRejectionReason, hasSkuTypes, hasIsActive] = await Promise.all([
      knex.schema.hasColumn("products", "status"),
      knex.schema.hasColumn("products", "rejection_reason"),
      knex.schema.hasColumn("products", "sku_types"),
      knex.schema.hasColumn("products", "is_active"),
    ]);

    await knex.schema.alterTable("products", (table) => {
      if (!hasStatus) table.text("status");
      if (!hasRejectionReason) table.text("rejection_reason");
      if (!hasSkuTypes) table.jsonb("sku_types");
    });

    if (hasIsActive) {
      await knex.raw(`
        update products
           set status = case
             when status is null or btrim(status) = '' then case when coalesce(is_active, false) = true then 'active' else 'inactive' end
             when lower(status) in ('pending', 'inactive', 'active', 'rejected') then lower(status)
             else case when coalesce(is_active, false) = true then 'active' else 'inactive' end
           end
      `);
    } else {
      await knex.raw(`
        update products
           set status = case
             when lower(status) in ('pending', 'inactive', 'active', 'rejected') then lower(status)
             else 'inactive'
           end
      `);
    }
    await knex.raw(`
      update products
         set sku_types = '[]'::jsonb
       where sku_types is null
    `);

    await knex.raw(`
      alter table products
      alter column status set default 'inactive',
      alter column status set not null,
      alter column sku_types set default '[]'::jsonb,
      alter column sku_types set not null
    `);

    await knex.raw(`
      alter table products
      drop constraint if exists products_status_check
    `);
    await knex.raw(`
      alter table products
      add constraint products_status_check
      check (status in ('pending', 'inactive', 'active', 'rejected'))
    `);
    await knex.raw(`
      create index if not exists products_status_idx on products(status)
    `);

    if (hasIsActive) {
      await knex.raw(`
        update products
           set is_active = case when status = 'active' then true else false end
         where is_active is distinct from (case when status = 'active' then true else false end)
      `);
      await knex.raw(`
        create or replace function sync_products_status_and_active()
        returns trigger
        language plpgsql
        as $$
        begin
          if new.status is null or btrim(new.status) = '' then
            new.status := case when coalesce(new.is_active, false) = true then 'active' else 'inactive' end;
          else
            new.status := lower(new.status);
            if new.status = 'active' then
              new.is_active := true;
            elsif new.status in ('inactive', 'pending', 'rejected') then
              new.is_active := false;
            else
              raise exception 'invalid products.status: %', new.status;
            end if;
          end if;
          return new;
        end;
        $$;
      `);
      await knex.raw(`
        drop trigger if exists products_sync_status_and_active_trg on products
      `);
      await knex.raw(`
        create trigger products_sync_status_and_active_trg
        before insert or update of status, is_active on products
        for each row
        execute function sync_products_status_and_active()
      `);
    }
  }

  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (hasEntityMediaLinks) {
    await knex.raw(`
      alter table entity_media_links
      drop constraint if exists entity_media_links_role_check
    `);
    await knex.raw(`
      alter table entity_media_links
      add constraint entity_media_links_role_check
      check (role in (
        'cover',
        'avatar',
        'gallery',
        'profile_photo',
        'listing_photo',
        'hero_carousel',
        'hero',
        'design_image'
      ))
    `);
    await knex.raw(`
      create unique index if not exists entity_media_links_product_design_image_unique
      on entity_media_links(entity_type, entity_id)
      where role = 'design_image' and entity_type = 'product'
    `);
  }
};

exports.down = async (knex) => {
  const hasEntityMediaLinks = await knex.schema.hasTable("entity_media_links");
  if (hasEntityMediaLinks) {
    await knex.raw("drop index if exists entity_media_links_product_design_image_unique");
    await knex.raw(`
      alter table entity_media_links
      drop constraint if exists entity_media_links_role_check
    `);
    await knex.raw(`
      alter table entity_media_links
      add constraint entity_media_links_role_check
      check (role in (
        'cover',
        'avatar',
        'gallery',
        'profile_photo',
        'listing_photo',
        'hero_carousel',
        'hero'
      ))
    `);
  }

  const hasProducts = await knex.schema.hasTable("products");
  if (!hasProducts) return;

  const [hasStatus, hasRejectionReason, hasSkuTypes] = await Promise.all([
    knex.schema.hasColumn("products", "status"),
    knex.schema.hasColumn("products", "rejection_reason"),
    knex.schema.hasColumn("products", "sku_types"),
  ]);

  if (await hasConstraint(knex, "products", "products_status_check")) {
    await knex.raw(`
      alter table products
      drop constraint if exists products_status_check
    `);
  }
  await knex.raw("drop index if exists products_status_idx");
  await knex.raw(`
    drop trigger if exists products_sync_status_and_active_trg on products
  `);
  await knex.raw(`
    drop function if exists sync_products_status_and_active()
  `);

  await knex.schema.alterTable("products", (table) => {
    if (hasStatus) table.dropColumn("status");
    if (hasRejectionReason) table.dropColumn("rejection_reason");
    if (hasSkuTypes) table.dropColumn("sku_types");
  });
};
