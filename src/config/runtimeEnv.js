"use strict";

const OIDC_CALLBACK_PATH = "/api/auth/oidc/google/callback";
const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173";
const DEFAULT_BACKEND_BASE_URL = "http://localhost:3000";
const DEFAULT_PORT = "3000";
const DEFAULT_BODY_SIZE_LIMIT = "2mb";
const STORAGE_PROVIDER_LOCAL = "local";
const STORAGE_PROVIDER_OBJECT = "object";

const FRONTEND_ORIGIN_BASE_KEYS = Object.freeze([
  "FRONTEND_ORIGIN",
  "PUBLIC_APP_ORIGIN",
  "APP_PUBLIC_URL",
  "OIDC_APP_BASE_URL",
  "UI_BASE_URL",
  "FRONTEND_URL",
  "CLIENT_URL",
  "PUBLIC_URL",
  "APP_URL",
]);

const BACKEND_BASE_URL_BASE_KEYS = Object.freeze([
  "BACKEND_BASE_URL",
  "BACKEND_PUBLIC_URL",
  "BACKEND_URL",
  "PUBLIC_BASE_URL",
]);

const OIDC_APP_BASE_URL_KEYS = Object.freeze([
  "OIDC_APP_BASE_URL",
  "APP_PUBLIC_URL",
  "UI_BASE_URL",
  "FRONTEND_URL",
  "CLIENT_URL",
  "PUBLIC_URL",
  "APP_URL",
]);

const trim = (value) => String(value || "").trim();
const trimNoTrailingSlash = (value) => trim(value).replace(/\/+$/, "");
const isTruthy = (value) => /^(1|true|yes|on)$/i.test(trim(value));
const isFalsey = (value) => /^(0|false|no|off)$/i.test(trim(value));
const isLocalhost = (hostname) => {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

const pickFirst = (env, keys, normalizer = trimNoTrailingSlash) => {
  for (const key of keys) {
    const value = normalizer(env[key]);
    if (value) {
      return { key, value };
    }
  }
  return { key: "", value: "" };
};

const getFrontendOriginKeys = ({ isProduction, isTest, isCi }) =>
  [
    "FRONTEND_ORIGIN",
    "PUBLIC_APP_ORIGIN",
    isTest ? "TEST_FRONTEND_ORIGIN" : "",
    isCi ? "CI_FRONTEND_ORIGIN" : "",
    isProduction ? "PROD_FRONTEND_ORIGIN" : "",
    isProduction ? "FRONTEND_ORIGIN_PROD" : "FRONTEND_ORIGIN_DEV",
    "DEV_FRONTEND_ORIGIN",
    ...FRONTEND_ORIGIN_BASE_KEYS.slice(2),
  ].filter(Boolean);

const getBackendBaseUrlKeys = ({ isProduction, isTest, isCi }) =>
  [
    "BACKEND_BASE_URL",
    isTest ? "TEST_BACKEND_BASE_URL" : "",
    isCi ? "CI_BACKEND_BASE_URL" : "",
    isProduction ? "PROD_BACKEND_BASE_URL" : "",
    isProduction ? "BACKEND_BASE_URL_PROD" : "BACKEND_BASE_URL_DEV",
    "DEV_BACKEND_BASE_URL",
    ...BACKEND_BASE_URL_BASE_KEYS.slice(1),
  ].filter(Boolean);

const parseHttpOrigin = (value, label, errors) => {
  const raw = trimNoTrailingSlash(value);
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_err) {
    errors.push(`${label} must be a valid absolute http(s) origin URL`);
    return "";
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    errors.push(`${label} must use http or https`);
    return "";
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    errors.push(`${label} must not include query/hash/credentials`);
    return "";
  }
  if (parsed.pathname && parsed.pathname !== "/") {
    errors.push(`${label} must not include a path`);
    return "";
  }
  return parsed.origin;
};

const parseHttpBaseUrl = (value, label, errors) => {
  const raw = trimNoTrailingSlash(value);
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_err) {
    errors.push(`${label} must be a valid absolute http(s) URL`);
    return "";
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    errors.push(`${label} must use http or https`);
    return "";
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    errors.push(`${label} must not include query/hash/credentials`);
    return "";
  }
  if (parsed.pathname && parsed.pathname !== "/") {
    errors.push(`${label} must not include a path`);
    return "";
  }
  return parsed.origin;
};

const parseCommaSeparatedOrigins = (value, label, errors) => {
  const raw = trim(value);
  if (!raw) return [];
  const entries = raw.split(",").map((item) => item.trim()).filter(Boolean);
  const parsed = [];
  entries.forEach((entry, index) => {
    const normalized = parseHttpOrigin(entry, `${label}[${index}]`, errors);
    if (normalized) parsed.push(normalized);
  });
  return [...new Set(parsed)];
};

const parseRelativePath = (value, label, errors, fallbackValue = "") => {
  const raw = trim(value);
  if (!raw) return fallbackValue;
  if (/^https?:\/\//i.test(raw)) {
    errors.push(`${label} must be a relative path`);
    return fallbackValue;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    errors.push(`${label} must start with a single "/"`);
    return fallbackValue;
  }
  if (raw.includes("?") || raw.includes("#")) {
    errors.push(`${label} must not include query string or hash`);
    return fallbackValue;
  }
  if (raw.length === 1) return raw;
  return raw.replace(/\/+$/, "");
};

const parseOidcRedirectUri = (value, errors) => {
  const raw = trimNoTrailingSlash(value);
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_err) {
    errors.push("OIDC_REDIRECT_URI must be a valid absolute URL");
    return "";
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    errors.push("OIDC_REDIRECT_URI must use http or https");
    return "";
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    errors.push("OIDC_REDIRECT_URI must not include query/hash/credentials");
    return "";
  }
  let pathname = parsed.pathname || "/";
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  if (pathname !== OIDC_CALLBACK_PATH) {
    errors.push(`OIDC_REDIRECT_URI path must be exactly ${OIDC_CALLBACK_PATH}`);
    return "";
  }
  parsed.pathname = pathname;
  return parsed.toString();
};

const createRuntimeEnv = (env = process.env) => {
  const warnings = [];
  const errors = [];

  const nodeEnvRaw = trim(env.NODE_ENV).toLowerCase();
  const appEnvRaw = trim(env.APP_ENV).toLowerCase();
  const nodeEnv = nodeEnvRaw || "development";
  const isTest = nodeEnv === "test";
  const isProduction = nodeEnv === "production" || appEnvRaw === "production";
  const isCi = isTruthy(env.CI);

  const port = trim(env.PORT) || DEFAULT_PORT;
  const bodySizeLimit = trim(env.BODY_SIZE_LIMIT) || DEFAULT_BODY_SIZE_LIMIT;

  const frontendOriginPicked = pickFirst(env, getFrontendOriginKeys({ isProduction, isTest, isCi }));
  const backendBaseUrlPicked = pickFirst(env, getBackendBaseUrlKeys({ isProduction, isTest, isCi }));
  const oidcAppBaseUrlPicked = pickFirst(env, OIDC_APP_BASE_URL_KEYS);

  let frontendOrigin = parseHttpOrigin(
    frontendOriginPicked.value,
    frontendOriginPicked.key || "FRONTEND_ORIGIN",
    errors
  );
  let backendBaseUrl = parseHttpBaseUrl(
    backendBaseUrlPicked.value,
    backendBaseUrlPicked.key || "BACKEND_BASE_URL",
    errors
  );
  let oidcAppBaseUrl = parseHttpOrigin(
    oidcAppBaseUrlPicked.value,
    oidcAppBaseUrlPicked.key || "OIDC_APP_BASE_URL",
    errors
  );

  if (!frontendOrigin && (isTest || !isProduction)) {
    frontendOrigin = DEFAULT_FRONTEND_ORIGIN;
  }
  if (!backendBaseUrl && (isTest || !isProduction)) {
    backendBaseUrl = DEFAULT_BACKEND_BASE_URL;
  }
  if (!oidcAppBaseUrl && !isProduction) {
    oidcAppBaseUrl = frontendOrigin;
  }

  if (isProduction) {
    if (!frontendOrigin) {
      errors.push(
        "Missing frontend origin. Set FRONTEND_ORIGIN (canonical) or a documented compatibility alias."
      );
    }
    if (!backendBaseUrl) {
      errors.push(
        "Missing backend base URL. Set BACKEND_BASE_URL (canonical) or a documented compatibility alias."
      );
    }
    if (frontendOrigin) {
      const host = new URL(frontendOrigin).hostname;
      if (isLocalhost(host)) {
        errors.push("FRONTEND_ORIGIN must not point to localhost in production");
      }
    }
    if (backendBaseUrl) {
      const host = new URL(backendBaseUrl).hostname;
      if (isLocalhost(host)) {
        errors.push("BACKEND_BASE_URL must not point to localhost in production");
      }
    }
  }

  const corsOrigins = parseCommaSeparatedOrigins(env.CORS_ORIGINS, "CORS_ORIGINS", errors);

  const oidcEnabledRaw = trim(env.OIDC_ENABLED).toLowerCase();
  const oidcEnabled = !isFalsey(oidcEnabledRaw);
  const oidcRedirectUri = parseOidcRedirectUri(env.OIDC_REDIRECT_URI, errors);
  const oidcAppCallbackPath = parseRelativePath(
    env.OIDC_APP_CALLBACK_PATH || env.OIDC_FRONTEND_CALLBACK_PATH,
    "OIDC_APP_CALLBACK_PATH",
    errors,
    "/auth/oidc/callback"
  );

  if (oidcEnabled && isProduction && !oidcAppBaseUrl) {
    errors.push(
      "OIDC_APP_BASE_URL is required in production when OIDC is enabled (compatibility aliases are accepted)."
    );
  }
  if (oidcEnabled && isProduction && oidcAppBaseUrl) {
    const host = new URL(oidcAppBaseUrl).hostname;
    if (isLocalhost(host)) {
      errors.push("OIDC_APP_BASE_URL must not point to localhost in production");
    }
  }

  const jwtSecret = trim(env.JWT_SECRET);
  const jwtAccessSecretAlias = trim(env.JWT_ACCESS_SECRET);
  const accessTokenSecret = jwtSecret || jwtAccessSecretAlias;
  const refreshTokenSecret = trim(env.JWT_REFRESH_SECRET);

  if (!isTest) {
    if (!accessTokenSecret) {
      errors.push("Missing JWT access signing secret. Set JWT_SECRET (canonical).");
    }
    if (!refreshTokenSecret) {
      errors.push("Missing JWT_REFRESH_SECRET.");
    }
    if (accessTokenSecret && refreshTokenSecret && accessTokenSecret === refreshTokenSecret) {
      errors.push("JWT_REFRESH_SECRET must be different from JWT_SECRET/JWT_ACCESS_SECRET.");
    }
  }

  if (!jwtSecret && jwtAccessSecretAlias) {
    warnings.push("JWT_ACCESS_SECRET alias is in use; set JWT_SECRET as canonical key.");
  }
  if (jwtSecret && jwtAccessSecretAlias && jwtSecret !== jwtAccessSecretAlias) {
    warnings.push("JWT_ACCESS_SECRET differs from JWT_SECRET; JWT_SECRET is authoritative.");
  }

  const storageProvider = trim(env.STORAGE_PROVIDER).toLowerCase() || STORAGE_PROVIDER_LOCAL;
  if (
    storageProvider !== STORAGE_PROVIDER_LOCAL &&
    storageProvider !== STORAGE_PROVIDER_OBJECT
  ) {
    warnings.push(
      `Unsupported STORAGE_PROVIDER="${storageProvider}" will fall back to "${STORAGE_PROVIDER_LOCAL}".`
    );
  }
  if (storageProvider === STORAGE_PROVIDER_OBJECT) {
    const missingObjectKeys = [];
    if (!trim(env.OBJECT_STORAGE_BUCKET)) missingObjectKeys.push("OBJECT_STORAGE_BUCKET");
    if (!trim(env.OBJECT_STORAGE_REGION)) missingObjectKeys.push("OBJECT_STORAGE_REGION");
    if (missingObjectKeys.length > 0) {
      errors.push(
        `[storage] STORAGE_PROVIDER=object requires: ${missingObjectKeys.join(", ")}`
      );
    }
  }

  const originMissing = [];
  if (!frontendOrigin) originMissing.push("frontendOrigin");
  if (!backendBaseUrl) originMissing.push("backendBaseUrl");
  const originReadiness = {
    frontendOrigin,
    backendBaseUrl,
    ready: originMissing.length === 0,
    missing: originMissing,
    isProduction,
    isTest,
    isCi,
  };

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    flags: {
      nodeEnv,
      appEnv: appEnvRaw,
      isProduction,
      isTest,
      isCi,
    },
    env: {
      port,
      bodySizeLimit,
      accessTokenSecret,
      refreshTokenSecret,
      oidcEnabled,
      oidcRedirectUri,
      oidcAppCallbackPath,
      corsOrigins,
      storageProvider,
    },
    origins: {
      frontendOrigin,
      backendBaseUrl,
      oidcAppBaseUrl,
    },
    sources: {
      frontendOrigin: frontendOriginPicked.key,
      backendBaseUrl: backendBaseUrlPicked.key,
      oidcAppBaseUrl: oidcAppBaseUrlPicked.key,
    },
    originReadiness,
  };
};

const formatRuntimeEnvErrors = (errors) => {
  return (errors || []).map((error, index) => `${index + 1}. ${error}`).join("\n");
};

const assertValidRuntimeEnv = (runtimeEnv) => {
  const resolved = runtimeEnv || createRuntimeEnv(process.env);
  if (resolved.ok) return resolved;
  const message = `[startup] invalid environment configuration\n${formatRuntimeEnvErrors(
    resolved.errors
  )}`;
  const err = new Error(message);
  err.code = "INVALID_RUNTIME_ENV";
  err.details = resolved.errors;
  throw err;
};

const applyRuntimeEnvCompatibility = (runtimeEnv) => {
  const resolved = runtimeEnv || createRuntimeEnv(process.env);
  if (!trim(process.env.JWT_SECRET) && trim(resolved.env.accessTokenSecret)) {
    process.env.JWT_SECRET = resolved.env.accessTokenSecret;
  }
  return resolved;
};

module.exports = {
  FRONTEND_ORIGIN_BASE_KEYS,
  BACKEND_BASE_URL_BASE_KEYS,
  getFrontendOriginKeys,
  getBackendBaseUrlKeys,
  OIDC_APP_BASE_URL_KEYS,
  OIDC_CALLBACK_PATH,
  DEFAULT_FRONTEND_ORIGIN,
  DEFAULT_BACKEND_BASE_URL,
  createRuntimeEnv,
  assertValidRuntimeEnv,
  applyRuntimeEnvCompatibility,
};
