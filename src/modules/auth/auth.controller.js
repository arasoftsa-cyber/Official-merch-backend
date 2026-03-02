"use strict";

const { hashPassword, verifyPassword } = require("../../utils/password");
const { getDb } = require("../../core/db/db");
const { ok, fail } = require("../../core/http/errorResponse");
const authService = require("./auth.service");
const userService = require("../users/user.api");

const PARTNER_ALLOWED_ROLES = new Set(["admin", "artist", "label"]);
const authDebugEnabled = process.env.AUTH_DEBUG === "1";
const ACCESS_COOKIE_NAME = "om_access_token";
const REFRESH_COOKIE_NAME = "om_refresh_token";
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";

const parseCookies = (cookieHeader) => {
  return String(cookieHeader || "")
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const idx = pair.indexOf("=");
      if (idx <= 0) return acc;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!key) return acc;
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
};

const getAuthCookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
  maxAge,
});

const setAuthCookies = (res, tokens) => {
  res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, getAuthCookieOptions(ACCESS_COOKIE_MAX_AGE_MS));
  res.cookie(
    REFRESH_COOKIE_NAME,
    tokens.refreshToken,
    getAuthCookieOptions(REFRESH_COOKIE_MAX_AGE_MS)
  );
};

const clearAuthCookies = (res) => {
  const baseOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };
  res.clearCookie(ACCESS_COOKIE_NAME, baseOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions);
};

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
    const hasLabelUsersMap = await db.schema.hasTable("label_users_map");
    if (!hasLabelUsersMap) return false;
    const labelLink = await db("label_users_map").where({ user_id: user.id }).first("user_id");
    return Boolean(labelLink);
  }

  if (role === "artist") {
    const hasArtistUserMap = await db.schema.hasTable("artist_user_map");
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

const ping = (req, res) => {
  ok(res, { ok: true, module: "auth" });
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await authenticateCredentials({ email, password, portal: "fan_or_general" });
    if (!user) {
      return fail(res, 401, "invalid_credentials", "Invalid email or password");
    }
    const payload = await buildAuthResponse(user);
    setAuthCookies(res, payload);
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
    setAuthCookies(res, payload);
    return ok(res, payload);
  } catch (err) {
    console.error("[auth.partnerLogin] failed", err);
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

    if (typeof password !== "string" || password.length < 6) {
      return fail(res, 400, "validation_error", "Password must be at least 6 characters");
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
    setAuthCookies(res, tokens);
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

const refresh = async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = String(
      req.body?.refreshToken || cookies[REFRESH_COOKIE_NAME] || ""
    ).trim();
    if (!refreshToken) {
      return fail(res, 400, "validation_error", "refreshToken is required");
    }

    const rotated = await authService.rotateRefreshToken({ refreshToken });
    setAuthCookies(res, rotated);
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
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = String(
      req.body?.refreshToken || cookies[REFRESH_COOKIE_NAME] || ""
    ).trim();
    if (refreshToken) {
      await authService.revokeRefreshToken({ refreshToken });
    }
    clearAuthCookies(res);
    return ok(res, { ok: true });
  } catch (err) {
    console.error("[auth.logout] failed", err);
    return fail(res, 500, "internal_server_error", "Failed to logout");
  }
};

module.exports = { ping, login, partnerLogin, register, refresh, logout };
