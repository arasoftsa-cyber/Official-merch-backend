"use strict";

const { createHash, randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { hasTableCached } = require("../core/db/schemaCache");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/jwt");

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_REFRESH_TOKEN_CODE = "INVALID_REFRESH_TOKEN";

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

const asInvalidRefreshError = () => {
  const err = new Error("invalid_refresh_token");
  err.code = INVALID_REFRESH_TOKEN_CODE;
  return err;
};

const rotateRefreshToken = async ({ refreshToken }) => {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (_err) {
    throw asInvalidRefreshError();
  }

  const userId = decoded?.sub || decoded?.user_id || decoded?.id || null;
  if (!userId) throw asInvalidRefreshError();

  const tokenHash = hashToken(refreshToken);
  const db = getDb();

  return db.transaction(async (trx) => {
    const existing = await trx("auth_refresh_tokens")
      .where({
        user_id: userId,
        token_hash: tokenHash,
      })
      .whereNull("revoked_at")
      .andWhere("expires_at", ">", trx.fn.now())
      .forUpdate()
      .first();

    if (!existing) {
      throw asInvalidRefreshError();
    }

    await trx("auth_refresh_tokens")
      .where({ token_hash: tokenHash })
      .whereNull("revoked_at")
      .update({ revoked_at: trx.fn.now() });

    const user = await findUserById(trx, userId);
    if (!user) {
      throw asInvalidRefreshError();
    }

    const tokens = await issueAuthTokensForUser({ user, trx });
    return { ...tokens, user };
  });
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
  INVALID_REFRESH_TOKEN_CODE,
  issueAuthTokensForUser,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
};
