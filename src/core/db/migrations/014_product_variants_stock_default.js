exports.up = async (knex) => {
  await knex.raw(
    "alter table product_variants alter column stock set default 0"
  );
};

exports.down = async (knex) => {
  await knex.raw(
    "alter table product_variants alter column stock drop default if exists"
  );
};
