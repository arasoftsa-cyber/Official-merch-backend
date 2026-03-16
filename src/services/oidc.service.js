"use strict";

const { Issuer, generators } = require("openid-client");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const { createRuntimeEnv } = require("../config/runtimeEnv");
const {
  getProcessLocalTrustBoundaryControl,
} = require("../core/runtime/trustBoundarySupport");
const {
  frontendOrigin,
  backendBaseUrl,
  isProduction,
} = require("../config/appOrigin");

const DEFAULT_PORTAL_RETURN_TO = Object.freeze({
  fan: "/fan",
  partner: "/partner/dashboard",
});
const PORTAL_LOGIN_PATH = Object.freeze({
  fan: "/fan/login",
  partner: "/partner/login",
});
const ALLOWED_PORTALS = new Set(["fan", "partner"]);
const STATE_TTL_SECONDS = 10 * 60;
const EXCHANGE_CODE_TTL_MS = 60 * 1000;
const OIDC_CALLBACK_PATH = "/api/auth/oidc/google/callback";
const DEFAULT_APP_CALLBACK_PATH = "/auth/oidc/callback";
const OIDC_STATE_VERSION = 1;

let oidcClientPromise = null;
let oidcConfigCache = null;
let frontendOidcConfigCache = null;
// Process-local only. Startup runtime validation blocks INSTANCE_MODE=multi until
// these exchange-code stores are backed by a shared coordination layer.
const exchangeCodeStore = new Map();
const consumedExchangeCodeStore = new Map();
const OIDC_EXCHANGE_CODE_CONTROL = getProcessLocalTrustBoundaryControl("oidc_exchange_codes");

const OIDC_CONTRACT_ERRORS = Object.freeze({
  INVALID_ORIGIN: {
    status: 400,
    code: "invalid_origin",
    message: "OIDC appOrigin must be an allowed frontend origin.",
  },
  INVALID_PORTAL: {
    status: 400,
    code: "invalid_portal",
    message: "portal must be fan or partner.",
  },
  INVALID_RETURN_TO: {
    status: 400,
    code: "invalid_return_to",
    message: "returnTo must be a safe internal path starting with '/'.",
  },
  INVALID_STATE: {
    status: 400,
    code: "invalid_state",
    message: "Invalid or expired OIDC state.",
  },
  OIDC_EXCHANGE_FAILED: {
    status: 401,
    code: "oidc_exchange_failed",
    message: "Failed to finalize OIDC exchange.",
  },
  OIDC_CALLBACK_REPLAY_OR_DUPLICATE: {
    status: 409,
    code: "oidc_callback_replay_or_duplicate",
    message: "OIDC callback code has already been consumed.",
  },
});

const isOidcEnabled = () => {
  const raw = String(process.env.OIDC_ENABLED || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  return true;
};

const getStateSecret = () => {
  const secret = String(process.env.OIDC_STATE_SECRET || process.env.JWT_SECRET || "").trim();
  if (!secret) {
    throw new Error("OIDC_STATE_SECRET or JWT_SECRET is required for OIDC state handling");
  }
  return secret;
};

const asOidcMisconfigured = (message) => {
  const err = new Error(message);
  err.code = "OIDC_MISCONFIGURED";
  return err;
};

const asOidcContractError = (contractError, extra) => {
  const selected = contractError || OIDC_CONTRACT_ERRORS.OIDC_EXCHANGE_FAILED;
  const err = new Error(selected.message);
  err.code = selected.code;
  err.status = selected.status;
  if (extra && typeof extra === "object") {
    err.details = extra;
  }
  return err;
};

const isProductionEnv = () =>
  String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

const parseDiscoveryUrl = (rawValue) => {
  const value = String(rawValue || "").trim();
  if (!value) {
    throw asOidcMisconfigured("OIDC_DISCOVERY_URL is required for OIDC");
  }

  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error("invalid protocol");
    }
    return parsed.toString();
  } catch (_err) {
    throw asOidcMisconfigured("OIDC_DISCOVERY_URL must be a valid http(s) URL");
  }
};

const normalizeRedirectUri = (rawValue) => {
  const value = String(rawValue || "").trim();
  if (!value) {
    throw asOidcMisconfigured("Unable to resolve OIDC redirect URI");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_err) {
    throw asOidcMisconfigured("OIDC_REDIRECT_URI must be a valid absolute URL");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw asOidcMisconfigured("OIDC_REDIRECT_URI must use http or https");
  }

  if (parsed.search || parsed.hash) {
    throw asOidcMisconfigured("OIDC_REDIRECT_URI must not include query string or hash");
  }

  let pathname = parsed.pathname || "/";
  if (pathname.length > 1) {
    pathname = pathname.replace(/\/+$/, "");
  }

  if (pathname !== OIDC_CALLBACK_PATH) {
    throw asOidcMisconfigured(
      `OIDC_REDIRECT_URI path must be exactly ${OIDC_CALLBACK_PATH}`
    );
  }

  parsed.pathname = pathname;
  return parsed.toString();
};

const getOidcConfig = () => {
  if (oidcConfigCache) return oidcConfigCache;

  if (!isOidcEnabled()) {
    const err = new Error("OIDC is disabled");
    err.code = "OIDC_DISABLED";
    throw err;
  }

  const clientId = String(process.env.OIDC_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.OIDC_CLIENT_SECRET || "").trim();
  if (!clientId) {
    throw asOidcMisconfigured("OIDC_CLIENT_ID is required for OIDC");
  }
  if (!clientSecret) {
    throw asOidcMisconfigured("OIDC_CLIENT_SECRET is required for OIDC");
  }

  const explicitRedirectUri = String(process.env.OIDC_REDIRECT_URI || "").trim();
  const resolvedRedirectUri = explicitRedirectUri
    ? normalizeRedirectUri(explicitRedirectUri)
    : backendBaseUrl
      ? normalizeRedirectUri(`${backendBaseUrl}${OIDC_CALLBACK_PATH}`)
      : "";

  if (!resolvedRedirectUri) {
    if (isProduction) {
      throw asOidcMisconfigured(
        "OIDC_REDIRECT_URI or BACKEND_BASE_URL is required for OIDC in production"
      );
    }
    throw asOidcMisconfigured("Unable to resolve OIDC redirect URI");
  }

  oidcConfigCache = {
    discoveryUrl: parseDiscoveryUrl(process.env.OIDC_DISCOVERY_URL),
    clientId,
    clientSecret,
    redirectUri: resolvedRedirectUri,
  };
  return oidcConfigCache;
};

const splitConfiguredOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const dedupe = (values) => [...new Set((values || []).filter(Boolean))];

const normalizeOriginFromUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.origin;
  } catch (_err) {
    return "";
  }
};

const normalizeConfiguredOrigin = (rawValue, label) => {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_err) {
    throw asOidcMisconfigured(`${label} must be a valid absolute http(s) URL`);
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw asOidcMisconfigured(`${label} must use http or https`);
  }

  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw asOidcMisconfigured(`${label} must be an origin URL without query/hash/credentials`);
  }

  const pathname = parsed.pathname || "/";
  if (pathname !== "/" && pathname !== "") {
    throw asOidcMisconfigured(
      `${label} must not include a path; use origin only (for example https://officialmerch.tech)`
    );
  }

  return parsed.origin;
};

const normalizeAppCallbackPath = (rawValue, label) => {
  const raw = String(rawValue || "").trim();
  if (!raw) return DEFAULT_APP_CALLBACK_PATH;
  if (/^https?:\/\//i.test(raw)) {
    throw asOidcMisconfigured(`${label} must be a relative path`);
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    throw asOidcMisconfigured(`${label} must start with a single "/"`);
  }
  if (raw.includes("?") || raw.includes("#")) {
    throw asOidcMisconfigured(`${label} must not include query string or hash`);
  }

  if (raw.length === 1) return raw;
  return raw.replace(/\/+$/, "");
};

const getConfiguredFrontendOrigins = () => {
  const runtimeEnv = createRuntimeEnv(process.env);
  const explicit = runtimeEnv.origins.oidcAppBaseUrl
    ? [normalizeConfiguredOrigin(runtimeEnv.origins.oidcAppBaseUrl, "OIDC_APP_BASE_URL")]
    : [];

  const corsConfigured = splitConfiguredOrigins(process.env.CORS_ORIGINS).map((value, index) =>
    normalizeConfiguredOrigin(value, `CORS_ORIGINS[${index}]`)
  );

  return {
    explicit: dedupe(explicit),
    corsConfigured: dedupe(corsConfigured),
  };
};

const getFrontendOidcConfig = () => {
  if (frontendOidcConfigCache) return frontendOidcConfigCache;

  const { explicit, corsConfigured } = getConfiguredFrontendOrigins();
  const prod = isProductionEnv();
  const primaryExplicitOrigin = explicit[0] || "";

  if (prod && !primaryExplicitOrigin) {
    throw asOidcMisconfigured("OIDC_APP_BASE_URL is required in production");
  }

  const fallbackOrigin = prod ? "" : frontendOrigin;
  const primaryOrigin = primaryExplicitOrigin || fallbackOrigin;
  if (!primaryOrigin) {
    throw asOidcMisconfigured("Unable to resolve frontend public origin for OIDC");
  }

  if (
    prod &&
    (primaryOrigin.toLowerCase().includes("localhost") ||
      primaryOrigin.includes("127.0.0.1"))
  ) {
    throw asOidcMisconfigured("Frontend public origin must not use localhost in production");
  }

  const allowedOrigins = dedupe([
    primaryOrigin,
    ...explicit,
    ...corsConfigured,
    ...(prod ? [] : [frontendOrigin]),
  ]);

  frontendOidcConfigCache = {
    primaryOrigin,
    allowedOrigins,
    appCallbackPath: normalizeAppCallbackPath(
      createRuntimeEnv(process.env).env.oidcAppCallbackPath || DEFAULT_APP_CALLBACK_PATH,
      "OIDC_APP_CALLBACK_PATH"
    ),
  };

  return frontendOidcConfigCache;
};

const getAllowedFrontendOrigins = () => {
  return getFrontendOidcConfig().allowedOrigins;
};

const isAllowedFrontendOrigin = (value) => {
  const normalized = normalizeOriginFromUrl(value);
  if (!normalized) return false;
  const allowed = getAllowedFrontendOrigins();
  return allowed.includes(normalized);
};

const normalizePortal = (value, fallback = "fan") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (ALLOWED_PORTALS.has(normalized)) return normalized;
  return fallback;
};

const validatePortal = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!ALLOWED_PORTALS.has(normalized)) {
    throw asOidcContractError(OIDC_CONTRACT_ERRORS.INVALID_PORTAL);
  }
  return normalized;
};

const decodeMaybe = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch (_err) {
    return raw;
  }
};

const isSafeInternalPath = (value) => {
  const normalized = String(value || "").trim();
  return normalized.startsWith("/") && !normalized.startsWith("//");
};

const validateReturnTo = (value, portal) => {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_PORTAL_RETURN_TO[normalizePortal(portal)];
  const decoded = decodeMaybe(raw);
  if (!isSafeInternalPath(decoded)) {
    throw asOidcContractError(OIDC_CONTRACT_ERRORS.INVALID_RETURN_TO);
  }
  return decoded;
};

const toSafeReturnTo = (value, portal) => {
  const fallback = DEFAULT_PORTAL_RETURN_TO[normalizePortal(portal)];
  try {
    return validateReturnTo(value, portal);
  } catch (_err) {
    return fallback;
  }
};

const firstForwardedValue = (value) => String(value || "").split(",")[0].trim();

const inferOriginFromRequest = (req) => {
  const originHeader = normalizeOriginFromUrl(req?.headers?.origin);
  if (originHeader) return originHeader;

  const refererOrigin = normalizeOriginFromUrl(req?.headers?.referer);
  if (refererOrigin) return refererOrigin;

  const forwardedHost = firstForwardedValue(req?.headers?.["x-forwarded-host"]);
  const forwardedProto = firstForwardedValue(req?.headers?.["x-forwarded-proto"]);
  if (forwardedHost && forwardedProto) {
    const forwardedOrigin = normalizeOriginFromUrl(`${forwardedProto}://${forwardedHost}`);
    if (forwardedOrigin) return forwardedOrigin;
  }

  const host = firstForwardedValue(req?.headers?.host);
  const protocolHint = forwardedProto || String(req?.protocol || "").trim();
  if (host && protocolHint) {
    const hostOrigin = normalizeOriginFromUrl(`${protocolHint}://${host}`);
    if (hostOrigin) return hostOrigin;
  }

  return "";
};

const resolveAppOrigin = (req, requestedAppOrigin) => {
  const frontendConfig = getFrontendOidcConfig();
  const prod = isProductionEnv();
  const requestedRaw = String(requestedAppOrigin || "").trim();
  if (requestedRaw) {
    const requested = normalizeOriginFromUrl(requestedRaw);
    if (!requested) {
      throw asOidcContractError(OIDC_CONTRACT_ERRORS.INVALID_ORIGIN);
    }
    if (!isAllowedFrontendOrigin(requested)) {
      throw asOidcContractError(OIDC_CONTRACT_ERRORS.INVALID_ORIGIN);
    }
    return requested;
  }

  if (prod) {
    return frontendConfig.primaryOrigin;
  }

  const inferred = inferOriginFromRequest(req);
  if (inferred && isAllowedFrontendOrigin(inferred)) {
    return inferred;
  }

  return frontendConfig.primaryOrigin;
};

const getOidcClient = async () => {
  const config = getOidcConfig();
  if (!oidcClientPromise) {
    oidcClientPromise = Issuer.discover(config.discoveryUrl).then(
      (issuer) =>
        new issuer.Client({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uris: [config.redirectUri],
          response_types: ["code"],
        })
    );
  }
  return oidcClientPromise;
};

const buildSignedState = ({ portal, returnTo, appOrigin, nonce }) => {
  const frontendConfig = getFrontendOidcConfig();
  const resolvedPortal = validatePortal(portal);
  const payload = {
    v: OIDC_STATE_VERSION,
    portal: resolvedPortal,
    returnTo: validateReturnTo(returnTo, resolvedPortal),
    appOrigin: isAllowedFrontendOrigin(appOrigin)
      ? normalizeOriginFromUrl(appOrigin)
      : frontendConfig.primaryOrigin,
    nonce: String(nonce || ""),
  };
  return jwt.sign(payload, getStateSecret(), { expiresIn: STATE_TTL_SECONDS });
};

const parseSignedState = (stateToken) => {
  try {
    const verified = jwt.verify(String(stateToken || ""), getStateSecret());
    const version = Number(verified?.v || 0);
    if (version !== OIDC_STATE_VERSION) {
      throw asOidcContractError(OIDC_CONTRACT_ERRORS.INVALID_STATE);
    }

    const portal = validatePortal(verified?.portal);
    const appOrigin = normalizeOriginFromUrl(verified?.appOrigin);
    if (!appOrigin || !isAllowedFrontendOrigin(appOrigin)) {
      throw asOidcContractError(OIDC_CONTRACT_ERRORS.INVALID_STATE);
    }

    return {
      portal,
      nonce: String(verified?.nonce || ""),
      returnTo: validateReturnTo(verified?.returnTo, portal),
      appOrigin,
    };
  } catch (err) {
    if (err?.code === OIDC_CONTRACT_ERRORS.INVALID_STATE.code) {
      throw err;
    }
    throw asOidcContractError(OIDC_CONTRACT_ERRORS.INVALID_STATE);
  }
};

const buildGoogleAuthorizationUrl = async ({ req, portal, returnTo, appOrigin }) => {
  const config = getOidcConfig();
  const client = await getOidcClient();
  const resolvedPortal = validatePortal(portal);
  const resolvedReturnTo = validateReturnTo(returnTo, resolvedPortal);
  const nonce = generators.nonce();
  const resolvedAppOrigin = resolveAppOrigin(req, appOrigin);
  const state = buildSignedState({
    portal: resolvedPortal,
    returnTo: resolvedReturnTo,
    appOrigin: resolvedAppOrigin,
    nonce,
  });
  const authorizationUrl = client.authorizationUrl({
    scope: "openid profile email",
    redirect_uri: config.redirectUri,
    state,
    nonce,
  });
  return {
    authorizationUrl,
    portal: resolvedPortal,
    returnTo: resolvedReturnTo,
    appOrigin: resolvedAppOrigin,
  };
};

const prepareGoogleOidcStart = async ({ req, query }) => {
  const portal = validatePortal(query?.portal);
  const returnTo = validateReturnTo(query?.returnTo, portal);
  const appOrigin = String(query?.appOrigin || "").trim();
  return buildGoogleAuthorizationUrl({
    req,
    portal,
    returnTo,
    appOrigin,
  });
};

const getPortalLoginPath = (portal) => PORTAL_LOGIN_PATH[validatePortal(portal)];

const appendQuery = (baseUrl, query) => {
  const rawBase = String(baseUrl || "").trim();
  const isAbsolute = /^https?:\/\//i.test(rawBase);
  const safeBase = rawBase || "/";
  const url = isAbsolute
    ? new URL(safeBase)
    : new URL(safeBase.startsWith("/") ? safeBase : `/${safeBase}`, frontendOrigin || "http://example.com");
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
};

const buildFrontendSuccessRedirect = ({
  appOrigin,
  appCallbackPath,
  portal,
  returnTo,
  exchangeCode,
}) => {
  const resolvedPortal = validatePortal(portal);
  const resolvedReturnTo = validateReturnTo(returnTo, resolvedPortal);
  const resolvedAppOrigin = resolveAppOrigin(null, appOrigin);
  const callbackPath = normalizeAppCallbackPath(appCallbackPath, "OIDC_APP_CALLBACK_PATH");
  return appendQuery(`${resolvedAppOrigin}${callbackPath}`, {
    portal: resolvedPortal,
    returnTo: resolvedReturnTo,
    code: String(exchangeCode || "").trim(),
  });
};

const buildFrontendFailureRedirect = ({
  appOrigin,
  portal,
  returnTo,
  errorCode,
  message,
}) => {
  const resolvedPortal = validatePortal(portal);
  const resolvedReturnTo = toSafeReturnTo(returnTo, resolvedPortal);
  const resolvedAppOrigin = resolveAppOrigin(null, appOrigin);
  const loginPath = getPortalLoginPath(resolvedPortal);
  return appendQuery(`${resolvedAppOrigin}${loginPath}`, {
    error: String(errorCode || "").trim(),
    message: String(message || "").trim(),
    portal: resolvedPortal,
    returnTo: resolvedReturnTo,
  });
};

const consumeGoogleCallback = async (req) => {
  try {
    const config = getOidcConfig();
    const frontendConfig = getFrontendOidcConfig();
    const client = await getOidcClient();
    const params = client.callbackParams(req);
    const parsedState = parseSignedState(params?.state);
    const tokenSet = await client.callback(config.redirectUri, params, {
      state: String(params?.state || ""),
      nonce: parsedState.nonce,
    });

    const claims = typeof tokenSet?.claims === "function" ? tokenSet.claims() : {};
    let userinfo = null;
    if ((!claims?.email || !claims?.sub) && tokenSet?.access_token) {
      userinfo = await client.userinfo(tokenSet.access_token).catch(() => null);
    }

    return {
      portal: parsedState.portal,
      returnTo: parsedState.returnTo,
      appOrigin: parsedState.appOrigin,
      appCallbackPath: frontendConfig.appCallbackPath,
      email: String(claims?.email || userinfo?.email || "")
        .trim()
        .toLowerCase(),
      sub: String(claims?.sub || userinfo?.sub || "").trim(),
      avatarUrl: String(claims?.picture || userinfo?.picture || "").trim() || null,
      emailVerified:
        typeof claims?.email_verified === "boolean"
          ? claims.email_verified
          : typeof userinfo?.email_verified === "boolean"
            ? userinfo.email_verified
            : null,
    };
  } catch (err) {
    if (
      err?.code === OIDC_CONTRACT_ERRORS.INVALID_STATE.code ||
      err?.code === OIDC_CONTRACT_ERRORS.INVALID_ORIGIN.code ||
      err?.code === OIDC_CONTRACT_ERRORS.INVALID_PORTAL.code ||
      err?.code === OIDC_CONTRACT_ERRORS.INVALID_RETURN_TO.code
    ) {
      throw err;
    }
    throw asOidcContractError(OIDC_CONTRACT_ERRORS.OIDC_EXCHANGE_FAILED);
  }
};

const sweepExchangeCodes = () => {
  const now = Date.now();
  for (const [code, entry] of exchangeCodeStore.entries()) {
    if (!entry || entry.expiresAt <= now) {
      exchangeCodeStore.delete(code);
    }
  }
  for (const [code, expiresAt] of consumedExchangeCodeStore.entries()) {
    if (!expiresAt || expiresAt <= now) {
      consumedExchangeCodeStore.delete(code);
    }
  }
};

const issueExchangeCode = (authPayload) => {
  sweepExchangeCodes();
  const code = randomUUID();
  consumedExchangeCodeStore.delete(code);
  exchangeCodeStore.set(code, {
    authPayload,
    expiresAt: Date.now() + EXCHANGE_CODE_TTL_MS,
  });
  return code;
};

const consumeExchangeCodeDetailed = (code) => {
  sweepExchangeCodes();
  const key = String(code || "").trim();
  if (!key) {
    return { ok: false, reason: "missing" };
  }

  if (consumedExchangeCodeStore.has(key)) {
    return { ok: false, reason: "duplicate" };
  }

  const entry = exchangeCodeStore.get(key);
  if (!entry) {
    return { ok: false, reason: "invalid_or_expired" };
  }
  exchangeCodeStore.delete(key);
  if (entry.expiresAt <= Date.now()) {
    return { ok: false, reason: "invalid_or_expired" };
  }
  consumedExchangeCodeStore.set(key, entry.expiresAt);
  return { ok: true, payload: entry.authPayload || null };
};

const consumeExchangeCode = (code) => {
  const result = consumeExchangeCodeDetailed(code);
  if (!result.ok) return null;
  return result.payload;
};

module.exports = {
  OIDC_CONTRACT_ERRORS,
  buildGoogleAuthorizationUrl,
  prepareGoogleOidcStart,
  consumeGoogleCallback,
  issueExchangeCode,
  consumeExchangeCode,
  consumeExchangeCodeDetailed,
  isOidcEnabled,
  getOidcConfig,
  getFrontendOidcConfig,
  OIDC_CALLBACK_PATH,
  parseSignedState,
  toSafeReturnTo,
  validatePortal,
  validateReturnTo,
  buildFrontendSuccessRedirect,
  buildFrontendFailureRedirect,
  OIDC_EXCHANGE_CODE_CONTROL,
};
