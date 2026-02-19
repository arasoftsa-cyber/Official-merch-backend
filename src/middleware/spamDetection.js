const recentOrders = new Map();
const ORDER_WINDOW_MS = 60_000;
const ORDER_MAX_PER_WINDOW = 3;

const ENVIRONMENT = process.env.NODE_ENV;
const isProd = ENVIRONMENT === 'production';
const orderSpamGuard = (req, res, next) => {
  if (!isProd) {
    // DEV/TEST ONLY. Do not enable in production.
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
    return res.status(429).json({
      error: "order_spam_detected",
      retryAfter,
    });
  }
  next();
};

module.exports = { orderSpamGuard };
