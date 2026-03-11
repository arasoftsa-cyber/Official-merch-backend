"use strict";

const { normalizeStorageResult } = require("./mediaMetadata");
const { applyUploadScanStatus } = require("./uploadScanPipeline");

const finalizeUploadedMedia = async ({
  saved,
  file,
  relativePath,
  env = process.env,
} = {}) => {
  const normalized = normalizeStorageResult({
    saved,
    file,
    relativePath,
  });
  const { storageResult } = await applyUploadScanStatus({
    storageResult: normalized,
    env,
  });
  return storageResult;
};

module.exports = {
  finalizeUploadedMedia,
};
