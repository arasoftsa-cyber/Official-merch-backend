const recentOrders = new Map();
const ORDER_WINDOW_MS = 60_000;
const ORDER_MAX_PER_WINDOW = 3;

const isEnabledFlag = (value) => {
  const normalized = String(value || "").toLowerCase();
  return normalized === "1" || normalized === "true";
};
const shouldBypassSpamGuard = (req) => {
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  const smokeSeedEnabled =
    isEnabledFlag(process.env.SMOKE_SEED_ENABLED) ||
    isEnabledFlag(process.env.SMOKE_SEED) ||
    isEnabledFlag(process.env.CI_SMOKE);
  const smokeHeader =
    String(req.headers?.["x-smoke-test"] || "").toLowerCase() === "1";
  return (
    isEnabledFlag(process.env.DISABLE_RATE_LIMIT) ||
    smokeSeedEnabled ||
    nodeEnv === "test" ||
    smokeHeader
  );
};

const orderSpamGuard = (req, res, next) => {
  // Bypass check must run before reading/updating in-memory buckets.
  if (shouldBypassSpamGuard(req)) {
    return next();
  }
  const key = req.user?.id || req.ip;
  const now = Date.now();
  const bucket = recentOrders.get(key) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > ORDER_WINDOW_MS) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  recentOrders.set(key, bucket);

  if (bucket.count > ORDER_MAX_PER_WINDOW) {
    const retryAfter = Math.ceil(
      (bucket.windowStart + ORDER_WINDOW_MS - now) / 1000
    );
    res.set("Retry-After", String(Math.max(retryAfter, 1)));
    console.log("[rate-limit] HIT", req.method, req.originalUrl, "ip=", req.ip);
    return res.status(429).json({
      error: "order_spam_detected",
      retryAfter,
    });
  }
  next();
};

module.exports = { orderSpamGuard };
