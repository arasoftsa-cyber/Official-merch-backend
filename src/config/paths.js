const path = require("path");

const BACKEND_ROOT_DIR = path.resolve(__dirname, "..", "..");
const UPLOADS_DIR = path.join(BACKEND_ROOT_DIR, "uploads");

module.exports = {
  BACKEND_ROOT_DIR,
  UPLOADS_DIR,
};

