"use strict";

const { createNoopScannerAdapter } = require("./noopScannerAdapter");

const DEFAULT_SCANNER_PROVIDER = "noop";
let cachedAdapter = null;

const normalizeName = (value) => String(value || "").trim().toLowerCase();

const createUploadScannerAdapter = (env = process.env) => {
  const provider = normalizeName(env.UPLOAD_SCANNER_PROVIDER || DEFAULT_SCANNER_PROVIDER);
  if (!provider || provider === DEFAULT_SCANNER_PROVIDER) {
    return createNoopScannerAdapter();
  }

  console.warn(`[upload-scan] unsupported UPLOAD_SCANNER_PROVIDER="${provider}", using noop scanner`);
  return createNoopScannerAdapter();
};

const getUploadScannerAdapter = () => {
  if (cachedAdapter) return cachedAdapter;
  cachedAdapter = createUploadScannerAdapter(process.env);
  return cachedAdapter;
};

const resetUploadScannerAdapterForTests = () => {
  cachedAdapter = null;
};

module.exports = {
  DEFAULT_SCANNER_PROVIDER,
  createUploadScannerAdapter,
  getUploadScannerAdapter,
  resetUploadScannerAdapterForTests,
};
