const dotenv = require("dotenv");

dotenv.config();

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("DATABASE_URL is required for knex configuration");
}

const baseConfig = {
  client: "pg",
  connection: dbUrl,
  migrations: {
    directory: "./src/config/migrations",
  },
};

module.exports = {
  development: baseConfig,
  production: baseConfig,
};
