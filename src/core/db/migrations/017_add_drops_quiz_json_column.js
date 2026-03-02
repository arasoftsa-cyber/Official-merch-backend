exports.up = async (knex) => {
  await knex.raw(`
    ALTER TABLE public.drops
    ADD COLUMN IF NOT EXISTS quiz_json JSONB NULL;
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    ALTER TABLE public.drops
    DROP COLUMN IF EXISTS quiz_json;
  `);
};

