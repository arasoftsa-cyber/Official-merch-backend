"use strict";

const { getUploadScannerAdapter } = require("./scanner");
const {
  getInitialUploadStatus,
  UPLOAD_STATUS_PENDING,
  normalizeUploadStatus,
} = require("./uploadStatus");

const applyUploadScanStatus = async ({ storageResult = {}, env = process.env } = {}) => {
  const initialStatus = getInitialUploadStatus(env);
  const status = normalizeUploadStatus(storageResult.status, initialStatus);
  const normalized = {
    ...storageResult,
    status,
  };

  if (status !== UPLOAD_STATUS_PENDING) {
    return { storageResult: normalized, scanEnqueue: null };
  }

  const scanner = getUploadScannerAdapter();
  const scanEnqueue = await scanner.enqueueScan({
    storageKey: normalized.storageKey,
    publicUrl: normalized.publicUrl,
    provider: normalized.provider,
    mimeType: normalized.mimeType,
    size: normalized.size,
  });

  return { storageResult: normalized, scanEnqueue };
};

module.exports = {
  applyUploadScanStatus,
};
