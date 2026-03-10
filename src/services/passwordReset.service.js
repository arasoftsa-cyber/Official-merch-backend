"use strict";

const { createHash, randomBytes } = require("crypto");
const { getDb } = require("../core/db/db");
const { hasColumnCached } = require("../core/db/schemaCache");
const { hashPassword } = require("../utils/password");
const authService = require("./auth.service");
const { sendEmailByTemplate } = require("./email.service");
const { buildPublicAppUrl, normalizeAppRelativePath } = require("./appPublicUrl.service");

const PASSWORD_RESET_TOKEN_COLUMN = "password_reset_token_hash";
const PASSWORD_RESET_EXPIRY_COLUMN = "password_reset_expires_at";
const DEFAULT_RESET_PATH = "/reset-password";
const DEFAULT_RESET_TTL_MINUTES = 60;

const parsePositiveInt = (value, fallbackValue) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallbackValue;
};

const hashToken = (token) =>
  createHash("sha256").update(String(token || "")).digest("hex");

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const buildPasswordResetUrl = (token) => {
  const path = normalizeAppRelativePath(
    process.env.PASSWORD_RESET_PATH || DEFAULT_RESET_PATH,
    DEFAULT_RESET_PATH
  );
  if (!path) return "";

  return buildPublicAppUrl({
    path,
    query: { token: String(token || "") },
  });
};

const getResetTtlMinutes = () =>
  parsePositiveInt(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES, DEFAULT_RESET_TTL_MINUTES);

const hasPasswordResetColumns = async (db) => {
  const hasTokenColumn = await hasColumnCached(db, "users", PASSWORD_RESET_TOKEN_COLUMN).catch(
    () => false
  );
  const hasExpiryColumn = await hasColumnCached(
    db,
    "users",
    PASSWORD_RESET_EXPIRY_COLUMN
  ).catch(() => false);
  return hasTokenColumn && hasExpiryColumn;
};

const findAuthUserByEmail = async (db, email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  return db("users")
    .whereRaw("lower(trim(email)) = ?", [normalizedEmail])
    .orderByRaw("case when lower(trim(email)) = ? then 0 else 1 end", [normalizedEmail])
    .orderBy("created_at", "asc")
    .first();
};

const issuePasswordReset = async ({ email }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { ok: true };

  const db = getDb();
  const hasColumns = await hasPasswordResetColumns(db);
  if (!hasColumns) {
    console.warn("[auth.passwordReset.forgot] users table missing password reset columns");
    return { ok: true };
  }

  const user = await findAuthUserByEmail(db, normalizedEmail);
  if (!user?.id || !user?.password_hash) {
    return { ok: true };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + getResetTtlMinutes() * 60 * 1000);

  await db("users").where({ id: user.id }).update({
    [PASSWORD_RESET_TOKEN_COLUMN]: tokenHash,
    [PASSWORD_RESET_EXPIRY_COLUMN]: expiresAt,
  });

  const resetUrl = buildPasswordResetUrl(rawToken);
  if (!resetUrl) {
    console.warn(
      "[auth.passwordReset.forgot] frontend public URL is not configured; reset email skipped"
    );
    return { ok: true };
  }

  try {
    await sendEmailByTemplate({
      templateKey: "password-reset",
      to: normalizedEmail,
      payload: {
        resetUrl,
        expiresInMinutes: getResetTtlMinutes(),
      },
      metadata: {
        flow: "password_reset",
      },
    });
  } catch (err) {
    console.warn(
      "[auth.passwordReset.forgot] failed to send reset email",
      err?.code || err?.message || err
    );
  }

  return { ok: true };
};

const asPasswordResetNotConfigured = () => {
  const err = new Error("Password reset columns are not configured");
  err.code = "PASSWORD_RESET_NOT_CONFIGURED";
  return err;
};

const resetPassword = async ({ token, password }) => {
  const rawToken = String(token || "").trim();
  if (!rawToken) {
    return { ok: false, reason: "invalid_or_expired_token" };
  }

  const db = getDb();
  const hasColumns = await hasPasswordResetColumns(db);
  if (!hasColumns) throw asPasswordResetNotConfigured();

  const tokenHash = hashToken(rawToken);

  return db.transaction(async (trx) => {
    const user = await trx("users")
      .where({ [PASSWORD_RESET_TOKEN_COLUMN]: tokenHash })
      .andWhere(PASSWORD_RESET_EXPIRY_COLUMN, ">", trx.fn.now())
      .first("id", "email");

    if (!user?.id) {
      return { ok: false, reason: "invalid_or_expired_token" };
    }

    const passwordHash = await hashPassword(password);
    const updated = await trx("users")
      .where({ id: user.id, [PASSWORD_RESET_TOKEN_COLUMN]: tokenHash })
      .andWhere(PASSWORD_RESET_EXPIRY_COLUMN, ">", trx.fn.now())
      .update({
        password_hash: passwordHash,
        [PASSWORD_RESET_TOKEN_COLUMN]: null,
        [PASSWORD_RESET_EXPIRY_COLUMN]: null,
      });

    if (Number(updated) < 1) {
      return { ok: false, reason: "invalid_or_expired_token" };
    }

    await authService.revokeAllRefreshTokensForUser({ userId: user.id, trx }).catch(() => 0);
    return { ok: true, userId: user.id };
  });
};

module.exports = {
  buildPasswordResetUrl,
  issuePasswordReset,
  resetPassword,
};
