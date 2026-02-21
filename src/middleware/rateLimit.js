const buckets = new Map();
const { recordFlag } = require("../utils/abuseFlags");

const NODE_ENV = String(process.env.NODE_ENV || "").toLowerCase();
const RATE_LIMIT_DISABLED =
  process.env.DISABLE_RATE_LIMIT === "1" || ["development", "test"].includes(NODE_ENV);
const RELAX_AUTH_LIMITER = RATE_LIMIT_DISABLED;
console.log(
  `[rate-limit] disabled=${RATE_LIMIT_DISABLED} env=${NODE_ENV || ""} flag=${String(
    process.env.DISABLE_RATE_LIMIT || ""
  )}`
);

const AUTH_LIMITER_BYPASS_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/whoami",
  "/auth/login",
  "/auth/register",
  "/auth/whoami",
  "/login",
  "/register",
  "/whoami",
  "/api/partner/login",
  "/partner/login",
]);

const getRequestPathCandidates = (req) => {
  const pickPath = (raw) => String(raw || "").split("?")[0].trim().toLowerCase();
  return [pickPath(req.originalUrl), pickPath(req.baseUrl + req.path), pickPath(req.path)];
};

const isAuthLimiterBypassRoute = (req) =>
  getRequestPathCandidates(req).some((path) => AUTH_LIMITER_BYPASS_PATHS.has(path));

const rateLimit = ({ windowMs = 60_000, max = 10, keyGenerator = (req) => req.ip } = {}) => {
  return (req, res, next) => {
    if (RATE_LIMIT_DISABLED) {
      return next();
    }
    const smokeHeader = req.headers["x-smoke-test"];
    if (
      (RELAX_AUTH_LIMITER && isAuthLimiterBypassRoute(req)) ||
      process.env.SMOKE_TEST === "1" ||
      smokeHeader === "1"
    ) {
      return next();
    }
    const key = keyGenerator(req) || req.ip;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.expiresAt) {
      bucket = { count: 0, expiresAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.expiresAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      console.log("[rate-limit] HIT", req.method, req.originalUrl, "ip=", req.ip);
      recordFlag({
        type: "rate_limit",
        key,
        reason: `exceeded ${max} requests per window`,
        metadata: { windowMs, max },
      });
      return res.status(429).json({ error: "too_many_requests", retryAfter });
    }
    next();
  };
};

module.exports = rateLimit;
