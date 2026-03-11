const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const APP_ROOT = path.resolve(__dirname, "../../..");
const NODE_ENV = String(process.env.NODE_ENV || "").trim() || "development";
const ENV_FILE_ORDER = [
  `.env.${NODE_ENV}.local`,
  NODE_ENV === "test" ? "" : ".env.local",
  `.env.${NODE_ENV}`,
  ".env",
].filter(Boolean);

const loadedFiles = [];

for (const fileName of ENV_FILE_ORDER) {
  const filePath = path.join(APP_ROOT, fileName);
  if (!fs.existsSync(filePath)) continue;
  dotenv.config({ path: filePath });
  loadedFiles.push(fileName);
}

const getEnvDiagnostics = () => ({
  appRoot: APP_ROOT,
  loadedFiles: [...loadedFiles],
});

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || 5000,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  getEnvDiagnostics,
};

module.exports = env;
