"use strict";

const { createHash, randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { hasTableCached } = require("../core/db/schemaCache");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/jwt");

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISSING_REFRESH_TOKEN_CODE = "MISSING_REFRESH_TOKEN";
const EXPIRED_REFRESH_TOKEN_CODE = "EXPIRED_REFRESH_TOKEN";
const REVOKED_REFRESH_TOKEN_CODE = "REVOKED_REFRESH_TOKEN";
const INVALID_REFRESH_SESSION_CODE = "INVALID_REFRESH_SESSION";
const INVALID_REFRESH_TOKEN_CODE = "INVALID_REFRESH_TOKEN";

const REFRESH_OUTCOME = Object.freeze({
  success: "success",
  missing: "missing",
  invalid: "invalid",
  expired: "expired",
  revokedOrReused: "revoked_or_reused",
  sessionInvalid: "session_invalid",
});

const hashToken = (token) =>
  createHash("sha256").update(String(token || "")).digest("hex");

const buildAuthPayload = (user) => ({
  sub: user.id,
  email: user.email,
  role: user.role,
});

const findUserById = async (db, userId) => {
  if (!userId) return null;
  return db("users").where({ id: userId }).first("id", "email", "role");
};

const issueRefreshToken = async ({ user, trx }) => {
  const db = trx || getDb();
  const refreshToken = signRefreshToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    type: "refresh",
    jti: randomUUID(),
  });
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await db("auth_refresh_tokens").insert({
    user_id: user.id,
    token_hash: tokenHash,
    created_at: db.fn.now(),
    expires_at: expiresAt,
    revoked_at: null,
  });

  return refreshToken;
};

const issueAuthTokensForUser = async ({ user, trx }) => {
  const accessToken = signAccessToken(buildAuthPayload(user));
  const refreshToken = await issueRefreshToken({ user, trx });
  return { accessToken, refreshToken };
};

const mapVerifyRefreshError = (err) => {
  if (err?.name === "TokenExpiredError") return EXPIRED_REFRESH_TOKEN_CODE;
  return INVALID_REFRESH_TOKEN_CODE;
};

const extractBearerToken = (authorizationHeader) => {
  const match = String(authorizationHeader || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
};

const resolveIncomingRefreshToken = (req = {}) => {
  const bodyToken = String(req?.body?.refreshToken || "").trim();
  if (bodyToken) return bodyToken;

  const headerToken = extractBearerToken(req?.headers?.authorization || req?.headers?.Authorization);
  if (headerToken) return String(headerToken).trim();

  const cookieToken = String(req?.cookies?.refreshToken || "").trim();
  if (cookieToken) return cookieToken;

  return "";
};

const normalizeRefreshFailure = (code) => {
  if (code === MISSING_REFRESH_TOKEN_CODE) {
    return {
      ok: false,
      outcome: REFRESH_OUTCOME.missing,
      code: "missing_refresh_token",
      message: "missing_refresh_token",
      status: 401,
      clearSession: true,
    };
  }
  if (code === EXPIRED_REFRESH_TOKEN_CODE) {
    return {
      ok: false,
      outcome: REFRESH_OUTCOME.expired,
      code: "expired_refresh_token",
      message: "Refresh token has expired",
      status: 401,
      clearSession: true,
    };
  }
  if (code === REVOKED_REFRESH_TOKEN_CODE) {
    return {
      ok: false,
      outcome: REFRESH_OUTCOME.revokedOrReused,
      code: "revoked_refresh_token",
      message: "Refresh token has been revoked or already used",
      status: 401,
      clearSession: true,
    };
  }
  if (code === INVALID_REFRESH_SESSION_CODE) {
    return {
      ok: false,
      outcome: REFRESH_OUTCOME.sessionInvalid,
      code: "invalid_refresh_session",
      message: "Refresh session is no longer valid",
      status: 401,
      clearSession: true,
    };
  }
  return {
    ok: false,
    outcome: REFRESH_OUTCOME.invalid,
    code: "invalid_refresh_token",
    message: "Invalid refresh token",
    status: 401,
    clearSession: true,
  };
};

const buildRefreshSuccessResult = ({ accessToken, refreshToken, user }) => ({
  ok: true,
  outcome: REFRESH_OUTCOME.success,
  status: 200,
  payload: {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  },
});

const refreshSession = async ({ refreshToken }) => {
  const token = String(refreshToken || "").trim();
  if (!token) {
    return normalizeRefreshFailure(MISSING_REFRESH_TOKEN_CODE);
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch (err) {
    return normalizeRefreshFailure(mapVerifyRefreshError(err));
  }

  const userId = String(decoded?.sub || decoded?.user_id || decoded?.id || "").trim();
  if (!userId) {
    return normalizeRefreshFailure(INVALID_REFRESH_TOKEN_CODE);
  }

  const tokenHash = hashToken(token);
  const db = getDb();

  try {
    return await db.transaction(async (trx) => {
      const tokenRow = await trx("auth_refresh_tokens")
        .where({
          user_id: userId,
          token_hash: tokenHash,
        })
        .forUpdate()
        .first();

      if (!tokenRow) {
        return normalizeRefreshFailure(INVALID_REFRESH_TOKEN_CODE);
      }

      if (tokenRow.revoked_at) {
        await revokeAllRefreshTokensForUser({ userId, trx }).catch(() => 0);
        return normalizeRefreshFailure(REVOKED_REFRESH_TOKEN_CODE);
      }

      if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        await trx("auth_refresh_tokens")
          .where({ token_hash: tokenHash })
          .whereNull("revoked_at")
          .update({ revoked_at: trx.fn.now() });
        return normalizeRefreshFailure(EXPIRED_REFRESH_TOKEN_CODE);
      }

      const revoked = await trx("auth_refresh_tokens")
        .where({ token_hash: tokenHash })
        .whereNull("revoked_at")
        .update({ revoked_at: trx.fn.now() });
      if (Number(revoked) < 1) {
        await revokeAllRefreshTokensForUser({ userId, trx }).catch(() => 0);
        return normalizeRefreshFailure(REVOKED_REFRESH_TOKEN_CODE);
      }

      const user = await findUserById(trx, userId);
      if (!user?.id) {
        await revokeAllRefreshTokensForUser({ userId, trx }).catch(() => 0);
        return normalizeRefreshFailure(INVALID_REFRESH_SESSION_CODE);
      }

      const tokens = await issueAuthTokensForUser({ user, trx });
      return buildRefreshSuccessResult({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user,
      });
    });
  } catch (err) {
    throw err;
  }
};

const refreshSessionFromRequest = async ({ req }) => {
  const refreshToken = resolveIncomingRefreshToken(req);
  return refreshSession({ refreshToken });
};

const revokeRefreshToken = async ({ refreshToken }) => {
  if (!refreshToken) return false;
  const db = getDb();
  const tokenHash = hashToken(refreshToken);
  const updated = await db("auth_refresh_tokens")
    .where({ token_hash: tokenHash })
    .whereNull("revoked_at")
    .update({ revoked_at: db.fn.now() });
  return Number(updated) > 0;
};

const revokeAllRefreshTokensForUser = async ({ userId, trx } = {}) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return 0;

  const db = trx || getDb();
  const hasRefreshTable = await hasTableCached(db, "auth_refresh_tokens").catch(() => false);
  if (!hasRefreshTable) return 0;

  const updated = await db("auth_refresh_tokens")
    .where({ user_id: normalizedUserId })
    .whereNull("revoked_at")
    .update({ revoked_at: db.fn.now() });

  return Number(updated) || 0;
};

module.exports = {
  issueAuthTokensForUser,
  refreshSession,
  refreshSessionFromRequest,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
};
