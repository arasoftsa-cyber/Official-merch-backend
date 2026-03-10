const { getDb } = require("../core/db/db");
const { toSafeDto } = require("../utils/user.model");
const { randomUUID } = require("crypto");

let usersColumnInfoPromise = null;

const getUsersColumnInfo = async (db) => {
  if (!usersColumnInfoPromise) {
    usersColumnInfoPromise = db("users")
      .columnInfo()
      .catch(() => ({}));
  }
  return usersColumnInfoPromise;
};

const pickExistingColumns = async (db, payload) => {
  const columns = await getUsersColumnInfo(db);
  if (!columns || typeof columns !== "object") return payload;

  const filtered = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (Object.prototype.hasOwnProperty.call(columns, key)) {
      filtered[key] = value;
    }
  }
  return filtered;
};

const resetUsersColumnInfoCacheForTests = () => {
  usersColumnInfoPromise = null;
};

const createUser = async ({
  email,
  passwordHash,
  role,
  authProvider = null,
  oidcSub = null,
  avatarUrl = null,
  emailVerified = null,
}) => {
  const db = getDb();
  const id = randomUUID();
  const insertPayload = await pickExistingColumns(db, {
    id,
    email,
    password_hash: passwordHash,
    role,
    created_at: db.fn.now(),
    ...(authProvider !== null ? { auth_provider: authProvider } : {}),
    ...(oidcSub !== null ? { oidc_sub: oidcSub } : {}),
    ...(avatarUrl !== null ? { avatar_url: avatarUrl } : {}),
    ...(emailVerified !== null ? { email_verified: emailVerified } : {}),
  });

  const [row] = await db("users")
    .insert(insertPayload)
    .returning("*");
  return toSafeDto(row);
};

const findByEmail = async (email) => {
  const db = getDb();
  const row = await db("users").where({ email }).first();
  return row;
};

const findById = async (id) => {
  const db = getDb();
  const row = await db("users").where({ id }).first();
  return toSafeDto(row);
};

const updateUserAuthProviderById = async (
  id,
  { authProvider = null, oidcSub = null, avatarUrl = null, emailVerified = null }
) => {
  const db = getDb();
  if (!id) return null;

  const patch = {};
  if (authProvider !== null) patch.auth_provider = authProvider;
  if (oidcSub !== null) patch.oidc_sub = oidcSub;
  if (avatarUrl !== null) patch.avatar_url = avatarUrl;
  if (emailVerified !== null) patch.email_verified = emailVerified;

  if (!Object.keys(patch).length) {
    const row = await db("users").where({ id }).first();
    return toSafeDto(row);
  }

  const safePatch = await pickExistingColumns(db, patch);
  if (!Object.keys(safePatch).length) {
    const row = await db("users").where({ id }).first();
    return toSafeDto(row);
  }

  const [row] = await db("users").where({ id }).update(safePatch).returning("*");
  return toSafeDto(row);
};

module.exports = {
  createUser,
  findByEmail,
  findById,
  updateUserAuthProviderById,
  __resetUsersColumnInfoCacheForTests: resetUsersColumnInfoCacheForTests,
};
