const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 10;

const hashPassword = async (plain) => {
  if (!plain) throw new Error("Plaintext password is required");
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plain, salt);
};

const verifyPassword = async (plain, hash) => {
  if (!plain) throw new Error("Plaintext password is required");
  return bcrypt.compare(plain, hash);
};

module.exports = { hashPassword, verifyPassword };
