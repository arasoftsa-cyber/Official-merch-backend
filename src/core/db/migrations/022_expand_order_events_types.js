exports.up = async (knex) => {
  await knex.raw(`
    ALTER TABLE order_events
    DROP CONSTRAINT IF EXISTS order_events_type_check
  `);
  await knex.raw(`
    ALTER TABLE order_events
    ADD CONSTRAINT order_events_type_check
    CHECK (type IN ('placed', 'cancelled', 'paid', 'fulfilled', 'refunded'))
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    ALTER TABLE order_events
    DROP CONSTRAINT IF EXISTS order_events_type_check
  `);
  await knex.raw(`
    ALTER TABLE order_events
    ADD CONSTRAINT order_events_type_check
    CHECK (type IN ('placed', 'cancelled', 'fulfilled'))
  `);
};

