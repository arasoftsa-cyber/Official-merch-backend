const jwt = require("jsonwebtoken");

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return secret;
};

let hasWarnedAboutRefreshSecretFallback = false;

const getRefreshSecret = () => {
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  if (refreshSecret) return refreshSecret;

  const fallback = process.env.JWT_SECRET;
  if (!fallback) throw new Error("JWT_REFRESH_SECRET is required");

  if (!hasWarnedAboutRefreshSecretFallback) {
    hasWarnedAboutRefreshSecretFallback = true;
    console.warn("[jwt] JWT_REFRESH_SECRET missing; falling back to JWT_SECRET");
  }
  return fallback;
};

const signToken = (payload, opts = {}) => {
  return jwt.sign(payload, getSecret(), { expiresIn: "1h", ...opts });
};

const signAccessToken = (payload, opts = {}) => {
  const useLegacyTtl = /^(1|true)$/i.test(
    String(process.env.JWT_ACCESS_TOKEN_LEGACY_1H || "").trim()
  );
  const defaultExpiresIn = useLegacyTtl ? "1h" : "15m";
  return jwt.sign(payload, getSecret(), { expiresIn: defaultExpiresIn, ...opts });
};

const signRefreshToken = (payload, opts = {}) => {
  return jwt.sign(payload, getRefreshSecret(), { expiresIn: "7d", ...opts });
};

const verifyToken = (token) => {
  return jwt.verify(token, getSecret());
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, getRefreshSecret());
};

module.exports = {
  signToken,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  verifyRefreshToken,
};
