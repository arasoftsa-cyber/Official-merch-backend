const { UPLOAD_ROOT_DIR } = require("./uploadPaths");

const BACKEND_ROOT_DIR = process.cwd();
const UPLOADS_DIR = UPLOAD_ROOT_DIR;

module.exports = {
  BACKEND_ROOT_DIR,
  UPLOADS_DIR,
};
