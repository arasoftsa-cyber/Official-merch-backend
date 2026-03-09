const { verifyToken } = require("../../utils/jwt");

const UNAUTHORIZED = { error: "unauthorized" };
const isProduction = process.env.NODE_ENV === "production";
const isDevEmailRoleMapEnabled =
  !isProduction &&
  /^(1|true)$/i.test(String(process.env.AUTH_DEV_EMAIL_ROLE_MAP_ENABLED || "").trim());

const devEmailRoleMap = (() => {
  if (!isDevEmailRoleMapEnabled) return {};
  const raw = String(process.env.AUTH_DEV_EMAIL_ROLE_MAP_JSON || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.entries(parsed).reduce((acc, [email, role]) => {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const normalizedRole = String(role || "").trim().toLowerCase();
      if (normalizedEmail && normalizedRole) {
        acc[normalizedEmail] = normalizedRole;
      }
      return acc;
    }, {});
  } catch (error) {
    console.warn("Invalid AUTH_DEV_EMAIL_ROLE_MAP_JSON; ignoring dev email role map");
    return {};
  }
})();

const normalizeRole = (decoded) => {
  const roleSource = decoded.role;
  if (roleSource) return roleSource.toLowerCase();
  if (isDevEmailRoleMapEnabled && decoded.email) {
    return devEmailRoleMap[String(decoded.email).toLowerCase()] || "";
  }
  return "";
};

const getBearerToken = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
};

const resolveToken = (req) => getBearerToken(req);

const attachAuthUser = (req, res, next) => {
  void res;
  const token = resolveToken(req);
  if (!token) {
    return next();
  }

  try {
    const decoded = verifyToken(token);
    const resolvedId =
      decoded.sub || decoded.user_id || decoded.id || decoded.userId || null;
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
  const token = resolveToken(req);
  if (!token) return res.status(401).json(UNAUTHORIZED);

  try {
    const decoded = verifyToken(token);
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
