exports.up = async (knex) => {
  await knex.raw('create extension if not exists "pgcrypto"');

  await knex.raw(
    'alter table products alter column id set default gen_random_uuid()'
  );
  await knex.raw(
    'alter table product_variants alter column id set default gen_random_uuid()'
  );
};

exports.down = async (knex) => {
  await knex.raw(
    'alter table products alter column id drop default if exists'
  );
  await knex.raw(
    'alter table product_variants alter column id drop default if exists'
  );
};
