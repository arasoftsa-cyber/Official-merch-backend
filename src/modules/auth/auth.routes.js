const express = require("express");
const router = express.Router();

const rateLimit = require("../../core/http/rateLimit");
const { ok } = require("../../core/http/errorResponse");
const { requireAuth } = require("../../core/http/auth.middleware");
const { requirePolicy } = require("../../core/http/policy.middleware");
const { ping, login, fanLogin, partnerLogin, register, refresh, logout } = require("./auth.controller");

const isProd = process.env.NODE_ENV === "production";
const loginRateLimiter = rateLimit({
  windowMs: 60_000,
  max: isProd ? 5 : 30,
  keyGenerator: (req) => req.ip,
});

router.get("/ping", ping);
router.post(
  "/login",
  express.json(),
  loginRateLimiter,
  login
);
router.post(
  "/fan/login",
  express.json(),
  loginRateLimiter,
  fanLogin
);
router.post(
  "/partner/login",
  express.json(),
  loginRateLimiter,
  partnerLogin
);
router.post("/register", express.json(), register);
router.post("/refresh", express.json(), refresh);
router.post("/logout", express.json(), logout);
router.get(
  "/probe",
  requireAuth,
  requirePolicy("admin:probe", "system"),
  (req, res) => {
    ok(res, { ok: true, probe: true, user: req.user });
  }
);
router.get("/whoami", requireAuth, (req, res) => {
  ok(res, { ok: true, user: req.user });
});
router.get(
  "/label-read",
  requireAuth,
  requirePolicy("label:artist:read", "system"),
  (req, res) => {
    ok(res, { ok: true, route: "label-read", user: req.user });
  }
);
router.get(
  "/label-mutate",
  requireAuth,
  requirePolicy("label:artist:write", "system"),
  (req, res) => {
    ok(res, { ok: true, route: "label-mutate", user: req.user });
  }
);

module.exports = router;
