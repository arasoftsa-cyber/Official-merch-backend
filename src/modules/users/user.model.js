const toSafeDto = (row) => {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
};

module.exports = { toSafeDto };
