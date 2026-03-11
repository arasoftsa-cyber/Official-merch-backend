"use strict";

const UPLOAD_STATUS_PENDING = "pending";
const UPLOAD_STATUS_AVAILABLE = "available";
const UPLOAD_STATUS_REJECTED = "rejected";
const UPLOAD_STATUS_FAILED = "failed";

const STATUS_SET = new Set([
  UPLOAD_STATUS_PENDING,
  UPLOAD_STATUS_AVAILABLE,
  UPLOAD_STATUS_REJECTED,
  UPLOAD_STATUS_FAILED,
]);

const normalizeUploadStatus = (value, fallback = UPLOAD_STATUS_AVAILABLE) => {
  const normalized = String(value || "").trim().toLowerCase();
  return STATUS_SET.has(normalized) ? normalized : fallback;
};

const isTruthy = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const isScanGated = (env = process.env) => {
  if (isTruthy(env.UPLOAD_SCAN_GATING)) return true;
  const mode = String(env.UPLOAD_SCAN_MODE || "").trim().toLowerCase();
  return mode === "gated" || mode === "pending";
};

const getInitialUploadStatus = (env = process.env) =>
  isScanGated(env) ? UPLOAD_STATUS_PENDING : UPLOAD_STATUS_AVAILABLE;

module.exports = {
  UPLOAD_STATUS_PENDING,
  UPLOAD_STATUS_AVAILABLE,
  UPLOAD_STATUS_REJECTED,
  UPLOAD_STATUS_FAILED,
  normalizeUploadStatus,
  isScanGated,
  getInitialUploadStatus,
};
