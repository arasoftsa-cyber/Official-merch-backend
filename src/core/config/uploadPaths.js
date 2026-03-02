"use strict";

const fs = require("fs");
const path = require("path");

const UPLOAD_ROOT_DIR = path.resolve(process.cwd(), "uploads");

const getUploadRoot = () => UPLOAD_ROOT_DIR;

const getUploadDir = (...segments) => path.join(UPLOAD_ROOT_DIR, ...segments);

const ensureUploadDir = (...segments) => {
  const dir = getUploadDir(...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

module.exports = {
  UPLOAD_ROOT_DIR,
  getUploadRoot,
  getUploadDir,
  ensureUploadDir,
};
