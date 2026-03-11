const toSafeDto = (row) => {
  if (!row) return null;
  const { password_hash, password_reset_token_hash, password_reset_expires_at, ...rest } = row;
  return rest;
};

module.exports = { toSafeDto };
