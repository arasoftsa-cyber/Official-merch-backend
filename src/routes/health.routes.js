const express = require("express");

const createHealthRouter = ({
  getDb,
  getEmailConfigReadiness,
  getOriginConfigReadiness,
}) => {
  const router = express.Router();

  const collectHealthState = async () => {
    const timestamp = new Date().toISOString();
    const originReadiness =
      typeof getOriginConfigReadiness === "function"
        ? getOriginConfigReadiness()
        : { ready: false, missing: ["origin_config_unavailable"] };
    const emailReadiness =
      typeof getEmailConfigReadiness === "function"
        ? getEmailConfigReadiness()
        : { configured: false };

    const dbCheck = {
      ok: false,
      error: null,
    };
    try {
      const db = getDb();
      await db.raw("select 1 as ok");
      dbCheck.ok = true;
    } catch (err) {
      void err;
      dbCheck.error = "db_ping_failed";
    }

    const blockingReady = dbCheck.ok && Boolean(originReadiness?.ready) && Boolean(emailReadiness?.ready);
    const warnings = [];
    if (emailReadiness?.configured === false && emailReadiness?.required !== true) {
      warnings.push("email_optional_not_configured");
    }

    return {
      timestamp,
      uptimeSeconds: Math.round(process.uptime()),
      live: true,
      ready: blockingReady,
      warnings,
      checks: {
        db: dbCheck,
        originConfig: originReadiness,
        emailConfig: emailReadiness,
      },
    };
  };

  router.get("/health/live", async (req, res) => {
    void req;
    const snapshot = await collectHealthState();
    return res.status(200).json({
      status: "ok",
      timestamp: snapshot.timestamp,
      uptimeSeconds: snapshot.uptimeSeconds,
      checks: {
        db: { ok: snapshot.checks.db.ok },
        originConfig: { ready: snapshot.checks.originConfig?.ready === true },
        emailConfig: {
          status: snapshot.checks.emailConfig?.status || "unknown",
          required: Boolean(snapshot.checks.emailConfig?.required),
          blocking: Boolean(snapshot.checks.emailConfig?.blocking),
        },
      },
    });
  });

  router.get("/health/ready", async (req, res) => {
    void req;
    const snapshot = await collectHealthState();
    return res.status(snapshot.ready ? 200 : 503).json({
      status: snapshot.ready ? "ok" : "degraded",
      timestamp: snapshot.timestamp,
      uptimeSeconds: snapshot.uptimeSeconds,
      blockingChecks: {
        db: snapshot.checks.db,
        originConfig: snapshot.checks.originConfig,
        emailConfig: {
          ready: Boolean(snapshot.checks.emailConfig?.ready),
          required: Boolean(snapshot.checks.emailConfig?.required),
          blocking: Boolean(snapshot.checks.emailConfig?.blocking),
          status: snapshot.checks.emailConfig?.status || "unknown",
          missingRequired: snapshot.checks.emailConfig?.missingRequired || [],
        },
      },
      warnings: snapshot.warnings,
    });
  });

  router.get("/health", async (req, res) => {
    void req;
    const snapshot = await collectHealthState();
    return res.status(snapshot.ready ? 200 : 503).json({
      status: snapshot.ready ? "ok" : "degraded",
      timestamp: snapshot.timestamp,
      uptimeSeconds: snapshot.uptimeSeconds,
      live: snapshot.live,
      ready: snapshot.ready,
      warnings: snapshot.warnings,
      checks: snapshot.checks,
    });
  });

  return router;
};

module.exports = createHealthRouter;
