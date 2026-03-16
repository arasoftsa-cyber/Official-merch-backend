"use strict";

const express = require("express");
const { getSystemCurrency } = require("../config/currency");
const { createRuntimeEnv } = require("../config/runtimeEnv");

const DEFAULT_LOCALE = "en-IN";
const DEFAULT_TIME_ZONE = "Asia/Kolkata";

const router = express.Router();

router.get("/", (_req, res) => {
  const runtime = createRuntimeEnv(process.env);

  return res.json({
    environment: runtime.flags.nodeEnv,
    apiBaseUrl: runtime.origins.backendBaseUrl || null,
    currency: getSystemCurrency(),
    locale: DEFAULT_LOCALE,
    timeZone: DEFAULT_TIME_ZONE,
    features: {
      oidcEnabled: Boolean(runtime.env.oidcEnabled),
      uploadsProvider: runtime.env.storageProvider || "local",
    },
  });
});

module.exports = router;
