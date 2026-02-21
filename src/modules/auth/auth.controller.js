const { signToken } = require("../../utils/jwt");
const { hashPassword, verifyPassword } = require("../../utils/password");
const { getDb } = require("../../config/db");
const userService = require("../users/user.service");

const PARTNER_ALLOWED_ROLES = new Set(["admin", "artist", "label"]);
const authDebugEnabled = process.env.AUTH_DEBUG === "1";

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

const buildAuthResponse = (user) => {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken = signToken(payload);

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
};

const ping = (req, res) => {
  res.json({ ok: true, module: "auth" });
};

const login = async (req, res) => {
  const { email, password } = req.body || {};
  const user = await authenticateCredentials({ email, password, portal: "fan_or_general" });
  if (!user) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  return res.json(buildAuthResponse(user));
};

const partnerLogin = async (req, res) => {
  const { email, password } = req.body || {};
  const user = await authenticateCredentials({ email, password, portal: "partner" });
  if (!user) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const role = String(user.role || "").toLowerCase();
  if (!PARTNER_ALLOWED_ROLES.has(role)) {
    logPartnerLogin("decision", { portal: "partner", userId: user.id, role, allowed: false });
    return res.status(401).json({ error: "fan_account" });
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
    return res.status(401).json({ error: "invalid_credentials" });
  }

  logPartnerLogin("decision", { portal: "partner", userId: user.id, role, allowed: true });
  return res.json(buildAuthResponse(user));
};

const register = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Email and password required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Invalid email" });
    }

    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({
        error: "validation_error",
        message: "Password must be at least 6 characters",
      });
    }

    const existing = await findAuthUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "email_exists" });
    }

    const passwordHash = await hashPassword(password);
    const user = await userService.createUser({
      email: normalizedEmail,
      passwordHash,
      role: "buyer",
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = signToken(payload);

    return res.status(200).json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[auth.register] failed", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
};

module.exports = { ping, login, partnerLogin, register };
