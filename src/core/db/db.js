const knex = require("knex");
const env = require("../config/env");

let dbInstance = null;

const createDb = () => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required before initializing the database");
  }

  if (!dbInstance) {
    dbInstance = knex({
      client: "pg",
      connection: env.DATABASE_URL,
      pool: {
        min: 2,
        max: 10,
        acquireTimeoutMillis: 10000,
        createTimeoutMillis: 10000,
        destroyTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      },
    });
  }

  return dbInstance;
};

const getDb = () => {
  return createDb();
};

module.exports = { getDb };
