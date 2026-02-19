const express = require("express");
const { postLead } = require("./lead.controller");

const router = express.Router();

const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 40;
const ipBuckets = new Map();

const leadRateLimit = (req, res, next) => {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || "unknown")
    .split(",")[0]
    .trim();
  const now = Date.now();
  const bucket = ipBuckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    // TODO: Replace with shared/distributed limiter (e.g. Redis) for multi-instance deployments.
    return res.status(429).json({ error: "rate_limited" });
  }

  bucket.count += 1;
  return next();
};

router.post("/", express.json(), leadRateLimit, postLead);

module.exports = router;
