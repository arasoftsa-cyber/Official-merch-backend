const jwt = require("jsonwebtoken");

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return secret;
};

const signToken = (payload, opts = {}) => {
  return jwt.sign(payload, getSecret(), { expiresIn: "1h", ...opts });
};

const verifyToken = (token) => {
  return jwt.verify(token, getSecret());
};

module.exports = { signToken, verifyToken };
