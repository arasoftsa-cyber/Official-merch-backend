"use strict";

const DEFAULT_DEV_APP_BASE_URL = "http://localhost:5173";
const FRONTEND_BASE_URL_KEYS = [
  "APP_PUBLIC_URL",
  "OIDC_APP_BASE_URL",
  "UI_BASE_URL",
  "FRONTEND_URL",
  "CLIENT_URL",
  "PUBLIC_URL",
  "APP_URL",
];

const isProductionEnv = () =>
  String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

const normalizeBaseUrl = (rawValue) => {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_err) {
    return "";
  }

  if (!/^https?:$/i.test(parsed.protocol)) return "";
  if (parsed.search || parsed.hash) return "";

  const isLocalhost =
    parsed.hostname.toLowerCase() === "localhost" || parsed.hostname === "127.0.0.1";
  if (isProductionEnv() && isLocalhost) {
    return "";
  }

  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString().replace(/\/+$/, "");
};

const normalizeAppRelativePath = (rawValue, fallbackValue = "/") => {
  const fallback = String(fallbackValue || "/").trim() || "/";
  const value = String(rawValue || "").trim();
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return "";
  if (!value.startsWith("/") || value.startsWith("//")) return "";
  if (value.includes("?") || value.includes("#")) return "";
  if (value.length === 1) return value;
  return value.replace(/\/+$/, "");
};

const resolveAppPublicBaseUrl = () => {
  for (const key of FRONTEND_BASE_URL_KEYS) {
    const normalized = normalizeBaseUrl(process.env[key]);
    if (normalized) return normalized;
  }

  if (!isProductionEnv()) return DEFAULT_DEV_APP_BASE_URL;
  return "";
};

const buildPublicAppUrl = ({ path = "/", query = {} } = {}) => {
  const appBaseUrl = resolveAppPublicBaseUrl();
  if (!appBaseUrl) return "";

  const normalizedPath = normalizeAppRelativePath(path, "/");
  if (!normalizedPath) return "";

  const url = new URL(normalizedPath, appBaseUrl);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(String(key), String(value));
  }
  return url.toString();
};

module.exports = {
  FRONTEND_BASE_URL_KEYS,
  resolveAppPublicBaseUrl,
  normalizeAppRelativePath,
  buildPublicAppUrl,
};

