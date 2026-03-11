const express = require("express");

const createHealthRouter = ({
  getDb,
  getEmailConfigReadiness,
  getOriginConfigReadiness,
}) => {
  const router = express.Router();

  router.get("/health", async (req, res) => {
    void req;
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
      dbCheck.error = String(err?.message || err || "db_ping_failed");
    }

    const ready =
      dbCheck.ok && Boolean(originReadiness?.ready) && Boolean(emailReadiness?.configured);
    const statusCode = ready ? 200 : 503;

    return res.status(statusCode).json({
      status: ready ? "ok" : "degraded",
      timestamp,
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        db: dbCheck,
        originConfig: originReadiness,
        emailConfig: emailReadiness,
      },
    });
  });

  return router;
};

module.exports = createHealthRouter;
