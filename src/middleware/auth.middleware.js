const { verifyToken } = require("../utils/jwt");

const UNAUTHORIZED = { error: "unauthorized" };

const normalizeRole = (decoded) => {
  const emailRoleMap = {
    "admin@test.com": "admin",
    "buyer@test.com": "buyer",
    "artist@test.com": "artist",
    "label@test.com": "label",
  };
  const roleSource = decoded.role;
  if (roleSource) return roleSource.toLowerCase();
  if (process.env.NODE_ENV === "development" && decoded.email) {
    return emailRoleMap[decoded.email.toLowerCase()] || "";
  }
  return "";
};

const attachAuthUser = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return next();
  }

  try {
    const decoded = verifyToken(match[1]);
    const resolvedId =
      decoded.sub || decoded.user_id || decoded.id || decoded.userId || null;
    let resolvedRole = decoded.role;
    if (!resolvedRole) {
      const emailRoleMap = {
        "admin@test.com": "admin",
        "buyer@test.com": "buyer",
        "artist@test.com": "artist",
        "label@test.com": "label",
      };
      if (process.env.NODE_ENV === "development" && decoded.email) {
        resolvedRole = emailRoleMap[decoded.email.toLowerCase()] || undefined;
      }
    }
    req.user = req.user || {};
    req.user.id = resolvedId;
    req.user.email = decoded.email;
    req.user.role = normalizeRole(decoded);
  } catch (error) {
    // ignore invalid token here; requireAuth will reject if needed
  }
  return next();
};

const requireAuth = (req, res, next) => {
  if (req.user?.id) {
    return next();
  }
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json(UNAUTHORIZED);

  try {
    const decoded = verifyToken(match[1]);
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: normalizeRole(decoded),
    };

    return next();
  } catch (error) {
    return res.status(401).json(UNAUTHORIZED);
  }
};

module.exports = { requireAuth, attachAuthUser };
