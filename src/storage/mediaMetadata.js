"use strict";

const { normalizeUploadStatus, UPLOAD_STATUS_AVAILABLE } = require("./uploadStatus");

const toSafeString = (value) => (value == null ? "" : String(value));

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const normalizeStorageResult = ({
  saved = {},
  file = null,
  relativePath = "",
  status = UPLOAD_STATUS_AVAILABLE,
} = {}) => {
  const storageKey = toSafeString(saved.storageKey || saved.relativePath || relativePath);
  const publicUrl = toSafeString(saved.publicUrl);
  const provider = toSafeString(saved.provider || "unknown");
  const mimeType = toSafeString(saved.mimeType || file?.mimetype || file?.mimeType);
  const size = toSafeNumber(saved.size ?? saved.sizeBytes ?? file?.size ?? file?.buffer?.length);
  const originalFilename = toSafeString(
    saved.originalFilename || file?.originalname || file?.originalFilename
  );

  return {
    storageKey,
    publicUrl,
    provider,
    mimeType,
    size,
    originalFilename,
    status: normalizeUploadStatus(status),
    // Backward-compatible aliases for existing local-path assumptions.
    relativePath: toSafeString(saved.relativePath || storageKey),
    absolutePath: toSafeString(saved.absolutePath),
    sizeBytes: toSafeNumber(saved.sizeBytes ?? size),
  };
};

module.exports = {
  normalizeStorageResult,
};
