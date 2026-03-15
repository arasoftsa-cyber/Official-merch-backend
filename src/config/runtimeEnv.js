"use strict";

const {
  trim,
  trimNoTrailingSlash,
  canonicalEnvAliasDefinitions,
  resolveCanonicalEnvMap,
} = require("../core/config/envAliases");
const {
  getTrustBoundaryRuntimeSupport,
} = require("../core/runtime/trustBoundarySupport");

const OIDC_CALLBACK_PATH = "/api/auth/oidc/google/callback";
const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173";
const DEFAULT_BACKEND_BASE_URL = "http://localhost:3000";
const DEFAULT_PORT = "3000";
const DEFAULT_BODY_SIZE_LIMIT = "2mb";
const STORAGE_PROVIDER_LOCAL = "local";
const STORAGE_PROVIDER_OBJECT = "object";
const isTruthy = (value) => /^(1|true|yes|on)$/i.test(trim(value));
const isFalsey = (value) => /^(0|false|no|off)$/i.test(trim(value));
const isLocalhost = (hostname) => {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

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

const emittedRuntimeEnvWarningKeys = new Set();

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
  const aliasDefinitions = canonicalEnvAliasDefinitions({ isProduction, isTest, isCi });
  const aliasResolution = resolveCanonicalEnvMap(env, aliasDefinitions);
  errors.push(...aliasResolution.errors);
  warnings.push(...aliasResolution.warnings);

  let frontendOrigin = parseHttpOrigin(
    aliasResolution.values.FRONTEND_ORIGIN,
    aliasResolution.sources.FRONTEND_ORIGIN || "FRONTEND_ORIGIN",
    errors
  );
  let backendBaseUrl = parseHttpBaseUrl(
    aliasResolution.values.BACKEND_BASE_URL,
    aliasResolution.sources.BACKEND_BASE_URL || "BACKEND_BASE_URL",
    errors
  );
  let oidcAppBaseUrl = parseHttpOrigin(
    aliasResolution.values.OIDC_APP_BASE_URL,
    aliasResolution.sources.OIDC_APP_BASE_URL || "OIDC_APP_BASE_URL",
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
        "Missing frontend origin. Set FRONTEND_ORIGIN."
      );
    }
    if (!backendBaseUrl) {
      errors.push(
        "Missing backend base URL. Set BACKEND_BASE_URL."
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
    aliasResolution.values.OIDC_APP_CALLBACK_PATH,
    "OIDC_APP_CALLBACK_PATH",
    errors,
    "/auth/oidc/callback"
  );

  if (oidcEnabled && isProduction && !oidcAppBaseUrl) {
    errors.push(
      "OIDC_APP_BASE_URL is required in production when OIDC is enabled."
    );
  }
  if (oidcEnabled && isProduction && oidcAppBaseUrl) {
    const host = new URL(oidcAppBaseUrl).hostname;
    if (isLocalhost(host)) {
      errors.push("OIDC_APP_BASE_URL must not point to localhost in production");
    }
  }

  const jwtSecret = aliasResolution.values.JWT_SECRET;
  const accessTokenSecret = jwtSecret;
  const refreshTokenSecret = trim(env.JWT_REFRESH_SECRET);

  if (!isTest) {
    if (!accessTokenSecret) {
      errors.push("Missing JWT access signing secret. Set JWT_SECRET (canonical).");
    }
    if (!refreshTokenSecret) {
      errors.push("Missing JWT_REFRESH_SECRET.");
    }
    if (accessTokenSecret && refreshTokenSecret && accessTokenSecret === refreshTokenSecret) {
      errors.push("JWT_REFRESH_SECRET must be different from JWT_SECRET.");
    }
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

  const trustBoundary = getTrustBoundaryRuntimeSupport(env);
  errors.push(...trustBoundary.errors);
  warnings.push(...trustBoundary.warnings);

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
    aliasWarnings: aliasResolution.aliasWarnings,
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
      instanceMode: trustBoundary.instanceMode,
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
    trustBoundary,
    sources: {
      frontendOrigin: aliasResolution.sources.FRONTEND_ORIGIN,
      backendBaseUrl: aliasResolution.sources.BACKEND_BASE_URL,
      oidcAppBaseUrl: aliasResolution.sources.OIDC_APP_BASE_URL,
      oidcAppCallbackPath: aliasResolution.sources.OIDC_APP_CALLBACK_PATH,
      jwtSecret: aliasResolution.sources.JWT_SECRET,
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

const emitRuntimeEnvWarnings = (runtimeEnv, warn = console.warn) => {
  const resolved = runtimeEnv || createRuntimeEnv(process.env);
  for (const warning of resolved.warnings || []) {
    const warningKey =
      typeof warning === "string"
        ? warning
        : `${warning.event}:${warning.instanceMode}:${(warning.controls || [])
            .map((control) => control.id)
            .join(",")}`;
    if (emittedRuntimeEnvWarningKeys.has(warningKey)) continue;
    emittedRuntimeEnvWarningKeys.add(warningKey);
    if (typeof warning === "string") {
      warn("[startup.env]", warning);
      continue;
    }
    warn("[startup.runtime]", warning);
  }
  for (const warning of resolved.aliasWarnings || []) {
    const warningKey = `${warning.event}:${warning.canonicalKey}`;
    if (emittedRuntimeEnvWarningKeys.has(warningKey)) continue;
    emittedRuntimeEnvWarningKeys.add(warningKey);
    warn("[startup.env]", warning);
  }
  return resolved;
};

module.exports = {
  OIDC_CALLBACK_PATH,
  DEFAULT_FRONTEND_ORIGIN,
  DEFAULT_BACKEND_BASE_URL,
  createRuntimeEnv,
  assertValidRuntimeEnv,
  applyRuntimeEnvCompatibility,
  emitRuntimeEnvWarnings,
};
