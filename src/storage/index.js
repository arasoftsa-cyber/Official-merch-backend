"use strict";

const { createLocalStorageProvider } = require("./localStorageProvider");
const {
  OBJECT_PROVIDER,
  createObjectStorageProviderFromEnv,
} = require("./objectStorageProvider");

const LOCAL_PROVIDER = "local";
let cachedProvider = null;

const normalizeProviderName = (value) => String(value || "").trim().toLowerCase();

const createStorageProvider = () => {
  const configured = normalizeProviderName(process.env.STORAGE_PROVIDER || LOCAL_PROVIDER);
  if (!configured || configured === LOCAL_PROVIDER) {
    return createLocalStorageProvider();
  }
  if (configured === OBJECT_PROVIDER) {
    return createObjectStorageProviderFromEnv(process.env);
  }

  console.warn(
    `[storage] unsupported STORAGE_PROVIDER="${configured}", falling back to "${LOCAL_PROVIDER}"`
  );
  return createLocalStorageProvider();
};

const getStorageProvider = () => {
  if (cachedProvider) return cachedProvider;
  cachedProvider = createStorageProvider();
  return cachedProvider;
};

const resetStorageProviderForTests = () => {
  cachedProvider = null;
};

module.exports = {
  LOCAL_PROVIDER,
  OBJECT_PROVIDER,
  createStorageProvider,
  getStorageProvider,
  resetStorageProviderForTests,
};
