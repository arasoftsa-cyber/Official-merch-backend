"use strict";

const trimTrailingSlash = (value) => String(value || "").trim().replace(/\/+$/, "");

const isTruthy = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());
const appEnv = String(process.env.APP_ENV || "").trim().toLowerCase();
const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
const isTest = nodeEnv === "test";
const isProduction = appEnv === "production" || nodeEnv === "production";
const isCi = isTruthy(process.env.CI);

const pickFirst = (...values) => {
  for (const value of values) {
    const normalized = trimTrailingSlash(value);
    if (normalized) return normalized;
  }
  return "";
};

const resolveFrontendOrigin = () => {
  const resolved = pickFirst(
    process.env.FRONTEND_ORIGIN,
    process.env.PUBLIC_APP_ORIGIN,
    isTest ? process.env.TEST_FRONTEND_ORIGIN : "",
    isCi ? process.env.CI_FRONTEND_ORIGIN : "",
    isProduction ? process.env.PROD_FRONTEND_ORIGIN : "",
    isProduction ? process.env.FRONTEND_ORIGIN_PROD : process.env.FRONTEND_ORIGIN_DEV,
    process.env.DEV_FRONTEND_ORIGIN,
    process.env.APP_PUBLIC_URL,
    process.env.OIDC_APP_BASE_URL,
    process.env.UI_BASE_URL,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    process.env.PUBLIC_URL,
    process.env.APP_URL
  );
  if (resolved) return resolved;
  if (isTest || !isProduction) return "http://localhost:5173";
  return "";
};

const resolveBackendBaseUrl = () => {
  const resolved = pickFirst(
    process.env.BACKEND_BASE_URL,
    isTest ? process.env.TEST_BACKEND_BASE_URL : "",
    isCi ? process.env.CI_BACKEND_BASE_URL : "",
    isProduction ? process.env.PROD_BACKEND_BASE_URL : "",
    isProduction ? process.env.BACKEND_BASE_URL_PROD : process.env.BACKEND_BASE_URL_DEV,
    process.env.DEV_BACKEND_BASE_URL,
    process.env.BACKEND_PUBLIC_URL,
    process.env.BACKEND_URL,
    process.env.PUBLIC_BASE_URL
  );
  if (resolved) return resolved;
  if (isTest || !isProduction) return "http://localhost:3000";
  return "";
};

const frontendOrigin = resolveFrontendOrigin();
const backendBaseUrl = resolveBackendBaseUrl();

module.exports = {
  isProduction,
  isTest,
  isCi,
  resolveFrontendOrigin,
  resolveBackendBaseUrl,
  frontendOrigin,
  backendBaseUrl,
};
