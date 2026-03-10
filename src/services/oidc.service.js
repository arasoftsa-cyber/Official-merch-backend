"use strict";

const { Issuer, generators } = require("openid-client");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const DEFAULT_PORTAL_RETURN_TO = Object.freeze({
  fan: "/fan",
  partner: "/partner/dashboard",
});
const ALLOWED_PORTALS = new Set(["fan", "partner"]);
const STATE_TTL_SECONDS = 10 * 60;
const EXCHANGE_CODE_TTL_MS = 60 * 1000;
const OIDC_CALLBACK_PATH = "/api/auth/oidc/google/callback";
const DEFAULT_DEV_FRONTEND_ORIGIN = "http://localhost:5173";
const DEFAULT_APP_CALLBACK_PATH = "/auth/oidc/callback";
const FRONTEND_ORIGIN_ENV_KEYS = [
  "OIDC_APP_BASE_URL",
  "APP_PUBLIC_URL",
  "UI_BASE_URL",
  "FRONTEND_URL",
  "CLIENT_URL",
  "PUBLIC_URL",
  "APP_URL",
];

let oidcClientPromise = null;
let oidcConfigCache = null;
let frontendOidcConfigCache = null;
const exchangeCodeStore = new Map();

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
    throw asOidcMisconfigured("OIDC_REDIRECT_URI is required for OIDC");
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

  oidcConfigCache = {
    discoveryUrl: parseDiscoveryUrl(process.env.OIDC_DISCOVERY_URL),
    clientId,
    clientSecret,
    redirectUri: normalizeRedirectUri(process.env.OIDC_REDIRECT_URI),
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
  const explicit = [];
  for (const envKey of FRONTEND_ORIGIN_ENV_KEYS) {
    const raw = String(process.env[envKey] || "").trim();
    if (!raw) continue;
    explicit.push(normalizeConfiguredOrigin(raw, envKey));
  }

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
    throw asOidcMisconfigured(
      "OIDC_APP_BASE_URL (or APP_PUBLIC_URL/UI_BASE_URL/FRONTEND_URL/CLIENT_URL) is required in production"
    );
  }

  const fallbackOrigin = prod ? "" : DEFAULT_DEV_FRONTEND_ORIGIN;
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
    ...(prod ? [] : [DEFAULT_DEV_FRONTEND_ORIGIN]),
  ]);

  frontendOidcConfigCache = {
    primaryOrigin,
    allowedOrigins,
    appCallbackPath: normalizeAppCallbackPath(
      process.env.OIDC_APP_CALLBACK_PATH || process.env.OIDC_FRONTEND_CALLBACK_PATH,
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

const toSafeReturnTo = (value, portal) => {
  const fallback = DEFAULT_PORTAL_RETURN_TO[normalizePortal(portal)];
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (_err) {
    decoded = raw;
  }
  if (decoded.startsWith("/") && !decoded.startsWith("//")) {
    return decoded;
  }
  return fallback;
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
  const requested = normalizeOriginFromUrl(requestedAppOrigin);
  if (requested && isAllowedFrontendOrigin(requested)) return requested;

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
  const payload = {
    portal: normalizePortal(portal),
    returnTo: toSafeReturnTo(returnTo, portal),
    appOrigin: isAllowedFrontendOrigin(appOrigin)
      ? normalizeOriginFromUrl(appOrigin)
      : frontendConfig.primaryOrigin,
    nonce: String(nonce || ""),
  };
  return jwt.sign(payload, getStateSecret(), { expiresIn: STATE_TTL_SECONDS });
};

const parseSignedState = (stateToken) => {
  const frontendConfig = getFrontendOidcConfig();
  const verified = jwt.verify(String(stateToken || ""), getStateSecret());
  const portal = normalizePortal(verified?.portal);
  return {
    portal,
    nonce: String(verified?.nonce || ""),
    returnTo: toSafeReturnTo(verified?.returnTo, portal),
    appOrigin: isAllowedFrontendOrigin(verified?.appOrigin)
      ? normalizeOriginFromUrl(verified?.appOrigin)
      : frontendConfig.primaryOrigin,
  };
};

const buildGoogleAuthorizationUrl = async ({ req, portal, returnTo, appOrigin }) => {
  const config = getOidcConfig();
  const client = await getOidcClient();
  const resolvedPortal = normalizePortal(portal);
  const nonce = generators.nonce();
  const resolvedAppOrigin = resolveAppOrigin(req, appOrigin);
  const state = buildSignedState({
    portal: resolvedPortal,
    returnTo,
    appOrigin: resolvedAppOrigin,
    nonce,
  });
  const authorizationUrl = client.authorizationUrl({
    scope: "openid profile email",
    redirect_uri: config.redirectUri,
    state,
    nonce,
  });
  return { authorizationUrl };
};

const consumeGoogleCallback = async (req) => {
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
};

const sweepExchangeCodes = () => {
  const now = Date.now();
  for (const [code, entry] of exchangeCodeStore.entries()) {
    if (!entry || entry.expiresAt <= now) {
      exchangeCodeStore.delete(code);
    }
  }
};

const issueExchangeCode = (authPayload) => {
  sweepExchangeCodes();
  const code = randomUUID();
  exchangeCodeStore.set(code, {
    authPayload,
    expiresAt: Date.now() + EXCHANGE_CODE_TTL_MS,
  });
  return code;
};

const consumeExchangeCode = (code) => {
  sweepExchangeCodes();
  const key = String(code || "").trim();
  if (!key) return null;

  const entry = exchangeCodeStore.get(key);
  if (!entry) return null;
  exchangeCodeStore.delete(key);
  if (entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry.authPayload || null;
};

module.exports = {
  buildGoogleAuthorizationUrl,
  consumeGoogleCallback,
  issueExchangeCode,
  consumeExchangeCode,
  isOidcEnabled,
  getOidcConfig,
  getFrontendOidcConfig,
  OIDC_CALLBACK_PATH,
  parseSignedState,
  toSafeReturnTo,
};
