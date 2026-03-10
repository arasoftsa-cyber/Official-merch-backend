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

let oidcClientPromise = null;
let oidcConfigCache = null;
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

const getAllowedFrontendOrigins = () => {
  const fromEnv = [
    process.env.OIDC_APP_BASE_URL,
    ...splitConfiguredOrigins(process.env.CORS_ORIGINS),
  ].filter(Boolean);
  const merged = [...new Set(["http://localhost:5173", ...fromEnv])];
  return merged;
};

const isAllowedFrontendOrigin = (value) => {
  if (!value) return false;
  const allowed = getAllowedFrontendOrigins();
  return allowed.includes(value);
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

const resolveAppOrigin = (req) => {
  const allowed = getAllowedFrontendOrigins();
  const originHeader = String(req?.headers?.origin || "").trim();
  if (isAllowedFrontendOrigin(originHeader)) return originHeader;

  const referer = String(req?.headers?.referer || "").trim();
  if (referer) {
    try {
      const parsed = new URL(referer);
      const origin = parsed.origin;
      if (isAllowedFrontendOrigin(origin)) return origin;
    } catch (_err) {
      // ignored
    }
  }

  return allowed[0] || "http://localhost:5173";
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
  const payload = {
    portal: normalizePortal(portal),
    returnTo: toSafeReturnTo(returnTo, portal),
    appOrigin: isAllowedFrontendOrigin(appOrigin) ? appOrigin : getAllowedFrontendOrigins()[0],
    nonce: String(nonce || ""),
  };
  return jwt.sign(payload, getStateSecret(), { expiresIn: STATE_TTL_SECONDS });
};

const parseSignedState = (stateToken) => {
  const verified = jwt.verify(String(stateToken || ""), getStateSecret());
  const portal = normalizePortal(verified?.portal);
  return {
    portal,
    nonce: String(verified?.nonce || ""),
    returnTo: toSafeReturnTo(verified?.returnTo, portal),
    appOrigin: isAllowedFrontendOrigin(verified?.appOrigin)
      ? verified.appOrigin
      : getAllowedFrontendOrigins()[0],
  };
};

const buildGoogleAuthorizationUrl = async ({ req, portal, returnTo }) => {
  const config = getOidcConfig();
  const client = await getOidcClient();
  const resolvedPortal = normalizePortal(portal);
  const nonce = generators.nonce();
  const state = buildSignedState({
    portal: resolvedPortal,
    returnTo,
    appOrigin: resolveAppOrigin(req),
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
  OIDC_CALLBACK_PATH,
  parseSignedState,
  toSafeReturnTo,
};
