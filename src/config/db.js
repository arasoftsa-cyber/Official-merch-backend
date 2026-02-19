const knex = require("knex");
const env = require("./env");

let dbInstance = null;

const createDb = () => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required before initializing the database");
  }

  if (!dbInstance) {
    dbInstance = knex({
      client: "pg",
      connection: env.DATABASE_URL,
    });
  }

  return dbInstance;
};

const getDb = () => {
  return createDb();
};

module.exports = { getDb };
