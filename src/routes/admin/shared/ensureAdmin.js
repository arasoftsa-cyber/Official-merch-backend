const FORBIDDEN = { error: "forbidden" };

const ensureAdmin = (req, res) => {
  if (req.user?.role !== "admin") {
    res.status(403).json(FORBIDDEN);
    return false;
  }
  return true;
};

module.exports = {
  ensureAdmin,
};
