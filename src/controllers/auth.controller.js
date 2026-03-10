"use strict";

const { randomUUID } = require("crypto");
const { hashPassword, verifyPassword } = require("../utils/password");
const { getDb } = require("../core/db/db");
const { hasTableCached } = require("../core/db/schemaCache");
const { ok, fail } = require("../core/http/errorResponse");
const { isLockedOut, recordFailedAttempt, clearFailedAttempts, getRemainingLockoutTime } = require("../core/http/accountLockout");
const authService = require("../services/auth.service");
const userService = require("../services/user.service");
const oidcService = require("../services/oidc.service");

const PARTNER_ALLOWED_ROLES = new Set(["admin", "artist", "label"]);
const FAN_ALLOWED_ROLES = new Set(["buyer", "fan"]);
const authDebugEnabled = process.env.AUTH_DEBUG === "1";
const DEFAULT_OIDC_APP_CALLBACK_PATH = "/auth/oidc/callback";

const logPartnerLogin = (...args) => {
  if (!authDebugEnabled) return;
  console.log("[auth.partner.login]", ...args);
};

const findAuthUserByEmail = async (email) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;
  const db = getDb();
  return db("users")
    .whereRaw("lower(trim(email)) = ?", [normalizedEmail])
    .orderByRaw("case when lower(trim(email)) = ? then 0 else 1 end", [normalizedEmail])
    .orderBy("created_at", "asc")
    .first();
};

const authenticateCredentials = async ({ email, password, portal = "general" }) => {
  if (!email || !password) return null;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  logPartnerLogin("attempt", { portal, email: normalizedEmail });
  const user = await findAuthUserByEmail(email);
  logPartnerLogin(
    "user",
    user ? { id: user.id, email: user.email, role: user.role } : { found: false }
  );
  if (!user?.password_hash) return null;
  const valid = await verifyPassword(password, user.password_hash).catch(() => false);
  logPartnerLogin("passwordCompare", { userId: user.id, valid });
  if (!valid) return null;
  return user;
};

const hasPartnerRoleAccess = async (user) => {
  if (!user?.id || !PARTNER_ALLOWED_ROLES.has(String(user.role || "").toLowerCase())) {
    return false;
  }
  const role = String(user.role || "").toLowerCase();
  if (role === "admin") return true;

  const db = getDb();
  if (role === "label") {
    const hasLabelUsersMap = await hasTableCached(db, "label_users_map");
    if (!hasLabelUsersMap) return false;
    const labelLink = await db("label_users_map").where({ user_id: user.id }).first("user_id");
    return Boolean(labelLink);
  }

  if (role === "artist") {
    const hasArtistUserMap = await hasTableCached(db, "artist_user_map");
    if (!hasArtistUserMap) return false;
    const artistLink = await db("artist_user_map").where({ user_id: user.id }).first("user_id");
    return Boolean(artistLink);
  }

  return false;
};

const buildAuthResponse = async (user) => {
  const { accessToken, refreshToken } = await authService.issueAuthTokensForUser({ user });
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
};

const getPortalLoginPath = (portal) => (portal === "partner" ? "/partner/login" : "/fan/login");

const getOidcFrontendDefaults = () => {
  const fallback = {
    appOrigin: "",
    appCallbackPath: DEFAULT_OIDC_APP_CALLBACK_PATH,
  };
  if (typeof oidcService.getFrontendOidcConfig !== "function") {
    return fallback;
  }
  try {
    const config = oidcService.getFrontendOidcConfig();
    return {
      appOrigin: String(config?.primaryOrigin || "").trim(),
      appCallbackPath: String(config?.appCallbackPath || DEFAULT_OIDC_APP_CALLBACK_PATH).trim(),
    };
  } catch (_err) {
    return fallback;
  }
};

const appendQuery = (baseUrl, query) => {
  const rawBase = String(baseUrl || "").trim();
  const isAbsolute = /^https?:\/\//i.test(rawBase);
  const safeBase = rawBase || "/";
  const url = isAbsolute
    ? new URL(safeBase)
    : new URL(safeBase.startsWith("/") ? safeBase : `/${safeBase}`, "http://localhost");
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
};

const redirectToFrontendLogin = (res, { appOrigin, portal, returnTo, portalError, message }) => {
  const loginPath = getPortalLoginPath(portal);
  const redirectUrl = appendQuery(`${appOrigin}${loginPath}`, {
    portalError,
    message,
    returnTo,
  });
  return res.redirect(302, redirectUrl);
};

const redirectToFrontendCallback = (res, { appOrigin, appCallbackPath, portal, returnTo, exchangeCode }) => {
  const callbackPath = String(appCallbackPath || DEFAULT_OIDC_APP_CALLBACK_PATH).trim();
  const callbackUrl = appendQuery(`${appOrigin}${callbackPath}`, {
    portal,
    returnTo,
    code: exchangeCode,
  });
  return res.redirect(302, callbackUrl);
};

const syncUserOidcProfile = async (user, { sub, avatarUrl, emailVerified }) => {
  const authProvider = "google";
  if (!user?.id) return user;

  const currentSub = String(user.oidc_sub || "").trim();
  const shouldUpdate =
    !currentSub ||
    currentSub === String(sub || "").trim() ||
    !String(user.auth_provider || "").trim();

  if (!shouldUpdate) return user;

  const updated = await userService.updateUserAuthProviderById(user.id, {
    authProvider,
    oidcSub: String(sub || "").trim() || null,
    avatarUrl: avatarUrl || null,
    emailVerified: typeof emailVerified === "boolean" ? emailVerified : null,
  });

  return updated || user;
};

const validatePasswordStrength = (password) => {
  if (typeof password !== "string") return false;
  if (password.length < 12) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
};

const ping = (req, res) => {
  ok(res, { ok: true, module: "auth" });
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizeEmail = String(email || "").trim().toLowerCase();

    if (isLockedOut(normalizeEmail)) {
      const remainingSeconds = Math.ceil(getRemainingLockoutTime(normalizeEmail) / 1000);
      return fail(
        res,
        429,
        "account_locked",
        `Too many failed attempts. Try again in ${remainingSeconds} seconds`
      );
    }

    const user = await authenticateCredentials({ email, password, portal: "fan_or_general" });
    if (!user) {
      const attempt = recordFailedAttempt(normalizeEmail);
      if (attempt.lockedOut) {
        const remainingSeconds = Math.ceil(getRemainingLockoutTime(normalizeEmail) / 1000);
        return fail(
          res,
          429,
          "account_locked",
          `Too many failed attempts. Try again in ${remainingSeconds} seconds`
        );
      }
      return fail(
        res,
        401,
        "invalid_credentials",
        `Invalid email or password. ${attempt.remainingAttempts} attempts remaining`
      );
    }

    clearFailedAttempts(normalizeEmail);
    const payload = await buildAuthResponse(user);
    return ok(res, payload);
  } catch (err) {
    console.error("[auth.login] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to login");
  }
};

const partnerLogin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await authenticateCredentials({ email, password, portal: "partner" });
    if (!user) {
      return fail(res, 401, "invalid_credentials", "Invalid email or password");
    }

    const role = String(user.role || "").toLowerCase();
    if (!PARTNER_ALLOWED_ROLES.has(role)) {
      logPartnerLogin("decision", { portal: "partner", userId: user.id, role, allowed: false });
      return fail(res, 401, "fan_account", "Fan accounts cannot access partner login");
    }
    const canAccessPartner = await hasPartnerRoleAccess(user);
    if (!canAccessPartner) {
      logPartnerLogin("decision", {
        portal: "partner",
        userId: user.id,
        role,
        allowed: false,
        reason: "missing_role_mapping",
      });
      return fail(res, 401, "invalid_credentials", "Invalid email or password");
    }

    logPartnerLogin("decision", { portal: "partner", userId: user.id, role, allowed: true });
    const payload = await buildAuthResponse(user);
    return ok(res, payload);
  } catch (err) {
    console.error("[auth.partnerLogin] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to login");
  }
};

const fanLogin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizeEmail = String(email || "").trim().toLowerCase();

    if (isLockedOut(normalizeEmail)) {
      const remainingSeconds = Math.ceil(getRemainingLockoutTime(normalizeEmail) / 1000);
      return fail(
        res,
        429,
        "account_locked",
        `Too many failed attempts. Try again in ${remainingSeconds} seconds`
      );
    }

    const user = await authenticateCredentials({ email, password, portal: "fan_only" });
    if (!user) {
      const attempt = recordFailedAttempt(normalizeEmail);
      if (attempt.lockedOut) {
        const remainingSeconds = Math.ceil(getRemainingLockoutTime(normalizeEmail) / 1000);
        return fail(
          res,
          429,
          "account_locked",
          `Too many failed attempts. Try again in ${remainingSeconds} seconds`
        );
      }
      return fail(
        res,
        401,
        "invalid_credentials",
        `Invalid email or password. ${attempt.remainingAttempts} attempts remaining`
      );
    }

    clearFailedAttempts(normalizeEmail);
    const role = String(user.role || "").toLowerCase();
    if (!FAN_ALLOWED_ROLES.has(role)) {
      return res.status(403).json({
        error: "ROLE_NOT_ALLOWED",
        message: "This account is for the Partner Portal.",
        redirectTo: "/partner/login",
      });
    }

    const payload = await buildAuthResponse(user);
    return ok(res, payload);
  } catch (err) {
    console.error("[auth.fanLogin] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to login");
  }
};

const register = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return fail(res, 400, "validation_error", "Email and password required");
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) {
      return fail(res, 400, "validation_error", "Invalid email");
    }

    if (!validatePasswordStrength(password)) {
      return fail(res, 400, "validation_error",
        "Password must be at least 12 characters and include uppercase, lowercase, numbers, and special characters"
      );
    }

    const existing = await findAuthUserByEmail(normalizedEmail);
    if (existing) {
      return fail(res, 409, "email_exists", "Email already exists");
    }

    const passwordHash = await hashPassword(password);
    const user = await userService.createUser({
      email: normalizedEmail,
      passwordHash,
      role: "buyer",
    });

    const tokens = await authService.issueAuthTokensForUser({ user });
    return res.status(200).json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[auth.register] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to register");
  }
};

const oidcGoogleStart = async (req, res) => {
  try {
    const portal = String(req.query?.portal || "").trim().toLowerCase();
    if (portal !== "fan" && portal !== "partner") {
      return fail(res, 400, "validation_error", "portal must be fan or partner");
    }
    const returnTo = oidcService.toSafeReturnTo(req.query?.returnTo || "", portal);
    const appOrigin = String(req.query?.appOrigin || "").trim();
    const { authorizationUrl } = await oidcService.buildGoogleAuthorizationUrl({
      req,
      portal,
      returnTo,
      appOrigin,
    });
    return res.redirect(302, authorizationUrl);
  } catch (err) {
    if (err?.code === "OIDC_DISABLED") {
      return fail(res, 404, "not_found", "OIDC authentication is disabled");
    }
    if (err?.code === "OIDC_MISCONFIGURED") {
      return fail(res, 503, "service_unavailable", err.message);
    }
    console.error("[auth.oidcGoogleStart] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to start Google authentication");
  }
};

const oidcGoogleCallback = async (req, res) => {
  const oidcDefaults = getOidcFrontendDefaults();
  let callbackContext = {
    portal: "fan",
    returnTo: "/fan",
    appOrigin: "http://officialmerch.tech",
  };

  try {
    const callbackData = await oidcService.consumeGoogleCallback(req);
    callbackContext = {
      portal: callbackData.portal,
      returnTo: callbackData.returnTo,
      appOrigin: callbackData.appOrigin,
      appCallbackPath: callbackData.appCallbackPath,
    };

    if (!callbackData.email || !callbackData.sub) {
      return redirectToFrontendLogin(res, {
        ...callbackContext,
        portalError: "oidc_profile_incomplete",
        message: "Google account did not return a usable email profile.",
      });
    }

    const existingUser = await findAuthUserByEmail(callbackData.email);

    if (callbackData.portal === "fan") {
      if (existingUser) {
        const existingRole = String(existingUser.role || "").toLowerCase();
        if (!FAN_ALLOWED_ROLES.has(existingRole)) {
          return redirectToFrontendLogin(res, {
            ...callbackContext,
            portalError: "partner_account",
            message: "This account belongs to the Partner Portal. Use partner login.",
          });
        }

        const syncedUser = await syncUserOidcProfile(existingUser, callbackData);
        const authPayload = await buildAuthResponse(syncedUser);
        const exchangeCode = oidcService.issueExchangeCode(authPayload);
        return redirectToFrontendCallback(res, { ...callbackContext, exchangeCode });
      }

      const generatedPasswordHash = await hashPassword(`oidc:${randomUUID()}`);
      const createdUser = await userService.createUser({
        email: callbackData.email,
        passwordHash: generatedPasswordHash,
        role: "buyer",
        authProvider: "google",
        oidcSub: callbackData.sub,
        avatarUrl: callbackData.avatarUrl,
        emailVerified: callbackData.emailVerified,
      });
      const authPayload = await buildAuthResponse(createdUser);
      const exchangeCode = oidcService.issueExchangeCode(authPayload);
      return redirectToFrontendCallback(res, { ...callbackContext, exchangeCode });
    }

    if (!existingUser) {
      return redirectToFrontendLogin(res, {
        ...callbackContext,
        portalError: "partner_unknown_account",
        message: "No approved partner account found for this Google email.",
      });
    }

    const existingRole = String(existingUser.role || "").toLowerCase();
    if (!PARTNER_ALLOWED_ROLES.has(existingRole)) {
      return redirectToFrontendLogin(res, {
        ...callbackContext,
        portalError: "fan_account",
        message: "Fan accounts cannot sign in to the Partner Portal.",
      });
    }

    const canAccessPartner = await hasPartnerRoleAccess(existingUser);
    if (!canAccessPartner) {
      return redirectToFrontendLogin(res, {
        ...callbackContext,
        portalError: "partner_not_approved",
        message: "Partner account is not approved yet.",
      });
    }

    const syncedUser = await syncUserOidcProfile(existingUser, callbackData);
    const authPayload = await buildAuthResponse(syncedUser);
    const exchangeCode = oidcService.issueExchangeCode(authPayload);
    return redirectToFrontendCallback(res, { ...callbackContext, exchangeCode });
  } catch (err) {
    try {
      if (req?.query?.state) {
        const parsed = oidcService.parseSignedState(req.query.state);
        callbackContext = {
          portal: parsed.portal,
          returnTo: parsed.returnTo,
          appOrigin: parsed.appOrigin,
        };
      }
    } catch (_stateErr) {
      // ignored
    }

    const fallbackMessage = "Google login failed. Please try again.";
    return redirectToFrontendLogin(res, {
      ...callbackContext,
      portalError: "oidc_failed",
      message: fallbackMessage,
    });
  }
};

const oidcGoogleExchange = async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();
    if (!code) {
      return fail(res, 400, "validation_error", "code is required");
    }
    const payload = oidcService.consumeExchangeCode(code);
    if (!payload) {
      return fail(res, 401, "invalid_exchange_code", "Invalid or expired OIDC exchange code");
    }
    return ok(res, payload);
  } catch (err) {
    console.error("[auth.oidcGoogleExchange] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to finalize Google authentication");
  }
};

const refresh = async (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken || null;

    if (!refreshToken) {
      return fail(res, 401, "unauthorized", "missing_refresh_token");
    }

    const rotated = await authService.rotateRefreshToken({
      refreshToken: String(refreshToken).trim(),
    });
    return ok(res, {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      user: {
        id: rotated.user.id,
        email: rotated.user.email,
        role: rotated.user.role,
      },
    });
  } catch (err) {
    if (err?.code === authService.INVALID_REFRESH_TOKEN_CODE) {
      return fail(res, 401, "invalid_refresh_token", "Invalid or expired refresh token");
    }
    console.error("[auth.refresh] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to refresh token");
  }
};

const logout = async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || "").trim();
    if (refreshToken) {
      await authService.revokeRefreshToken({ refreshToken });
    }
    return ok(res, { ok: true });
  } catch (err) {
    console.error("[auth.logout] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to logout");
  }
};

module.exports = {
  ping,
  login,
  fanLogin,
  partnerLogin,
  register,
  oidcGoogleStart,
  oidcGoogleCallback,
  oidcGoogleExchange,
  refresh,
  logout,
};
