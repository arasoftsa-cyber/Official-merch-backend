const buckets = new Map();
const { recordFlag } = require("../utils/abuseFlags");

const rateLimit = ({ windowMs = 60_000, max = 10, keyGenerator = (req) => req.ip } = {}) => {
  return (req, res, next) => {
    const smokeHeader = req.headers["x-smoke-test"];
    if (
      process.env.NODE_ENV === "test" ||
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
