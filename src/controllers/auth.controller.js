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
const passwordResetService = require("../services/passwordReset.service");
const { sendEmailByTemplate } = require("../services/email.service");
const { buildPublicAppUrl } = require("../services/appPublicUrl.service");
const { frontendOrigin } = require("../config/appOrigin");

const PARTNER_ALLOWED_ROLES = new Set(["admin", "artist", "label"]);
const FAN_ALLOWED_ROLES = new Set(["buyer", "fan"]);
const authDebugEnabled = process.env.AUTH_DEBUG === "1";
const DEFAULT_OIDC_APP_CALLBACK_PATH = "/auth/oidc/callback";
const PASSWORD_FORGOT_GENERIC_MESSAGE =
  "If an account exists for this email, a password reset link has been sent.";
const WELCOME_DEFAULT_LOGIN_PATH = "/fan/login";
const AUTH_ERRORS = {
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
  INVALID_CREDENTIALS: {
    status: 401,
    code: "invalid_credentials",
    message: "Invalid email or password",
  },
  PORTAL_MISMATCH_FAN_TO_PARTNER: {
    status: 403,
    code: "auth_portal_mismatch_fan_to_partner",
    message: "This account belongs to the Partner Portal. Use partner login.",
    portal: "partner",
  },
  PORTAL_MISMATCH_PARTNER_TO_FAN: {
    status: 403,
    code: "auth_portal_mismatch_partner_to_fan",
    message: "This account belongs to the Fan Portal. Use fan login.",
    portal: "fan",
  },
  PARTNER_ACCOUNT_NOT_FOUND: {
    status: 403,
    code: "auth_partner_account_not_found",
    message: "No approved partner account found for this email.",
    portal: "partner",
  },
  PARTNER_ACCOUNT_UNAPPROVED: {
    status: 403,
    code: "auth_partner_account_unapproved",
    message: "Partner account is not approved yet.",
    portal: "partner",
  },
  OIDC_PROFILE_INCOMPLETE: {
    status: 400,
    code: "auth_oidc_profile_incomplete",
    message: "Google account did not return a usable email profile.",
  },
  OIDC_FAILED: {
    status: 500,
    code: "auth_oidc_failed",
    message: "Google login failed. Please try again.",
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
};

const logPartnerLogin = (...args) => {
  if (!authDebugEnabled) return;
  console.log("[auth.partner.login]", ...args);
};

const failAuthContract = (res, authError, extra) =>
  fail(res, authError.status, authError.code, authError.message, extra);

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

const mapOidcContractErrorToAuthError = (err) => {
  const code = String(err?.code || "").trim().toLowerCase();
  if (code === AUTH_ERRORS.INVALID_ORIGIN.code) return AUTH_ERRORS.INVALID_ORIGIN;
  if (code === AUTH_ERRORS.INVALID_PORTAL.code) return AUTH_ERRORS.INVALID_PORTAL;
  if (code === AUTH_ERRORS.INVALID_RETURN_TO.code) return AUTH_ERRORS.INVALID_RETURN_TO;
  if (code === AUTH_ERRORS.INVALID_STATE.code) return AUTH_ERRORS.INVALID_STATE;
  if (code === AUTH_ERRORS.OIDC_EXCHANGE_FAILED.code) return AUTH_ERRORS.OIDC_EXCHANGE_FAILED;
  if (code === AUTH_ERRORS.OIDC_CALLBACK_REPLAY_OR_DUPLICATE.code) {
    return AUTH_ERRORS.OIDC_CALLBACK_REPLAY_OR_DUPLICATE;
  }
  return null;
};

const redirectToFrontendLogin = (res, { appOrigin, portal, returnTo, authError }) => {
  const redirectUrl = oidcService.buildFrontendFailureRedirect({
    appOrigin,
    portal,
    returnTo,
    errorCode: String(authError?.code || "").trim(),
    message: String(authError?.message || "").trim(),
  });
  return res.redirect(302, redirectUrl);
};

const redirectToFrontendCallback = (res, { appOrigin, appCallbackPath, portal, returnTo, exchangeCode }) => {
  const callbackUrl = oidcService.buildFrontendSuccessRedirect({
    appOrigin,
    appCallbackPath: String(appCallbackPath || DEFAULT_OIDC_APP_CALLBACK_PATH).trim(),
    portal,
    returnTo,
    exchangeCode,
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
      return failAuthContract(res, AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    const role = String(user.role || "").toLowerCase();
    if (!PARTNER_ALLOWED_ROLES.has(role)) {
      logPartnerLogin("decision", { portal: "partner", userId: user.id, role, allowed: false });
      return failAuthContract(res, AUTH_ERRORS.PORTAL_MISMATCH_PARTNER_TO_FAN);
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
      return failAuthContract(res, AUTH_ERRORS.PARTNER_ACCOUNT_UNAPPROVED);
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
      return failAuthContract(res, AUTH_ERRORS.PORTAL_MISMATCH_FAN_TO_PARTNER);
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
    void sendWelcomeAccountEmailBestEffort({
      email: user?.email || normalizedEmail,
      source: "auth_register",
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

const sendWelcomeAccountEmailBestEffort = async ({ email, source }) => {
  try {
    const recipient = String(email || "").trim().toLowerCase();
    if (!recipient) return;

    const loginUrl = buildPublicAppUrl({ path: WELCOME_DEFAULT_LOGIN_PATH });
    const appUrl = buildPublicAppUrl({ path: "/" });
    const result = await sendEmailByTemplate({
      templateKey: "welcome-account",
      to: recipient,
      payload: {
        appUrl,
        loginUrl,
      },
      metadata: {
        flow: "welcome_account",
        source: String(source || "").trim() || "unknown",
      },
    });

    if (result.errorCode && !result.skipped) {
      console.warn("[auth.welcomeEmail] failed", result.errorCode);
    }
  } catch (err) {
    console.warn("[auth.welcomeEmail] failed", err?.code || err?.message || err);
  }
};

const passwordForgot = async (req, res) => {
  const email = String(req.body?.email || "").trim();
  try {
    await passwordResetService.issuePasswordReset({ email });
  } catch (err) {
    console.warn("[auth.passwordForgot] failed", err?.code || err?.message || err);
  }

  return ok(res, {
    ok: true,
    message: PASSWORD_FORGOT_GENERIC_MESSAGE,
  });
};

const passwordReset = async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");

    if (!token || !password) {
      return fail(res, 400, "validation_error", "token and password are required");
    }
    if (!validatePasswordStrength(password)) {
      return fail(
        res,
        400,
        "validation_error",
        "Password must be at least 12 characters and include uppercase, lowercase, numbers, and special characters"
      );
    }

    const result = await passwordResetService.resetPassword({ token, password });
    if (!result?.ok) {
      return fail(
        res,
        400,
        "invalid_or_expired_token",
        "Password reset token is invalid or expired"
      );
    }

    return ok(res, { ok: true, message: "Password has been reset successfully" });
  } catch (err) {
    if (err?.code === "PASSWORD_RESET_NOT_CONFIGURED") {
      return fail(
        res,
        503,
        "service_unavailable",
        "Password reset is temporarily unavailable"
      );
    }
    console.error("[auth.passwordReset] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to reset password");
  }
};

const oidcGoogleStart = async (req, res) => {
  try {
    const { authorizationUrl } = await oidcService.prepareGoogleOidcStart({
      req,
      query: req.query,
    });
    return res.redirect(302, authorizationUrl);
  } catch (err) {
    const mappedContractError = mapOidcContractErrorToAuthError(err);
    if (mappedContractError) {
      return failAuthContract(res, mappedContractError);
    }
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
    appOrigin: oidcDefaults.appOrigin || frontendOrigin,
    appCallbackPath: oidcDefaults.appCallbackPath || DEFAULT_OIDC_APP_CALLBACK_PATH,
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
        authError: AUTH_ERRORS.OIDC_PROFILE_INCOMPLETE,
      });
    }

    const existingUser = await findAuthUserByEmail(callbackData.email);

    if (callbackData.portal === "fan") {
      if (existingUser) {
        const existingRole = String(existingUser.role || "").toLowerCase();
        if (!FAN_ALLOWED_ROLES.has(existingRole)) {
          return redirectToFrontendLogin(res, {
            ...callbackContext,
            authError: AUTH_ERRORS.PORTAL_MISMATCH_FAN_TO_PARTNER,
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
      void sendWelcomeAccountEmailBestEffort({
        email: createdUser?.email || callbackData.email,
        source: "oidc_fan_signup",
      });
      const authPayload = await buildAuthResponse(createdUser);
      const exchangeCode = oidcService.issueExchangeCode(authPayload);
      return redirectToFrontendCallback(res, { ...callbackContext, exchangeCode });
    }

    if (!existingUser) {
      return redirectToFrontendLogin(res, {
        ...callbackContext,
        authError: AUTH_ERRORS.PARTNER_ACCOUNT_NOT_FOUND,
      });
    }

    const existingRole = String(existingUser.role || "").toLowerCase();
    if (!PARTNER_ALLOWED_ROLES.has(existingRole)) {
      return redirectToFrontendLogin(res, {
        ...callbackContext,
        authError: AUTH_ERRORS.PORTAL_MISMATCH_PARTNER_TO_FAN,
      });
    }

    const canAccessPartner = await hasPartnerRoleAccess(existingUser);
    if (!canAccessPartner) {
      return redirectToFrontendLogin(res, {
        ...callbackContext,
        authError: AUTH_ERRORS.PARTNER_ACCOUNT_UNAPPROVED,
      });
    }

    const syncedUser = await syncUserOidcProfile(existingUser, callbackData);
    const authPayload = await buildAuthResponse(syncedUser);
    const exchangeCode = oidcService.issueExchangeCode(authPayload);
    return redirectToFrontendCallback(res, { ...callbackContext, exchangeCode });
  } catch (err) {
    const mappedContractError = mapOidcContractErrorToAuthError(err);
    try {
      if (req?.query?.state) {
        const parsed = oidcService.parseSignedState(req.query.state);
        callbackContext = {
          portal: parsed.portal,
          returnTo: parsed.returnTo,
          appOrigin: parsed.appOrigin,
          appCallbackPath: oidcDefaults.appCallbackPath || DEFAULT_OIDC_APP_CALLBACK_PATH,
        };
      }
    } catch (_stateErr) {
      // ignored
    }

    const fallbackAuthError = mappedContractError || AUTH_ERRORS.OIDC_FAILED;
    const fallbackMessage = String(fallbackAuthError.message || AUTH_ERRORS.OIDC_FAILED.message);
    return redirectToFrontendLogin(res, {
      ...callbackContext,
      authError: {
        ...fallbackAuthError,
        message: fallbackMessage,
      },
    });
  }
};

const oidcGoogleExchange = async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();
    if (!code) {
      return fail(res, 400, AUTH_ERRORS.OIDC_EXCHANGE_FAILED.code, "OIDC exchange code is required.");
    }
    const exchangeResult = oidcService.consumeExchangeCodeDetailed(code);
    if (!exchangeResult?.ok) {
      if (exchangeResult?.reason === "duplicate") {
        return fail(
          res,
          AUTH_ERRORS.OIDC_CALLBACK_REPLAY_OR_DUPLICATE.status,
          AUTH_ERRORS.OIDC_CALLBACK_REPLAY_OR_DUPLICATE.code,
          AUTH_ERRORS.OIDC_CALLBACK_REPLAY_OR_DUPLICATE.message
        );
      }
      return fail(
        res,
        AUTH_ERRORS.OIDC_EXCHANGE_FAILED.status,
        AUTH_ERRORS.OIDC_EXCHANGE_FAILED.code,
        AUTH_ERRORS.OIDC_EXCHANGE_FAILED.message
      );
    }
    return ok(res, exchangeResult.payload);
  } catch (err) {
    console.error("[auth.oidcGoogleExchange] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to finalize Google authentication");
  }
};

const refresh = async (req, res) => {
  try {
    const result = await authService.refreshSessionFromRequest({ req });
    if (result?.ok) {
      return ok(res, result.payload);
    }
    const status = Number(result?.status || 401);
    const errorCode = String(result?.code || "invalid_refresh_token");
    const errorMessage = String(result?.message || "Invalid refresh token");
    return fail(res, status, errorCode, errorMessage);
  } catch (err) {
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
  passwordForgot,
  passwordReset,
  oidcGoogleStart,
  oidcGoogleCallback,
  oidcGoogleExchange,
  refresh,
  logout,
};
