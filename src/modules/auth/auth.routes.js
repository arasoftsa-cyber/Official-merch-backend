const express = require("express");
const router = express.Router();

const rateLimit = require("../../middleware/rateLimit");
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const { ping, login, register } = require("./auth.controller");

const loginRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => req.ip,
});
const isProd = process.env.NODE_ENV === "production";

router.get("/ping", ping);
router.post(
  "/login",
  express.json(),
  ...(isProd ? [loginRateLimiter] : []),
  login
);
router.post("/register", express.json(), register);
router.get(
  "/probe",
  requireAuth,
  requirePolicy("admin:probe", "system"),
  (req, res) => {
    res.json({ ok: true, probe: true, user: req.user });
  }
);
router.get("/whoami", requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});
router.get(
  "/label-read",
  requireAuth,
  requirePolicy("label:artist:read", "system"),
  (req, res) => {
    res.json({ ok: true, route: "label-read", user: req.user });
  }
);
router.get(
  "/label-mutate",
  requireAuth,
  requirePolicy("label:artist:write", "system"),
  (req, res) => {
    res.json({ ok: true, route: "label-mutate", user: req.user });
  }
);

module.exports = router;
