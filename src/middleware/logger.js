const env = require("../config/env");

const logRequest = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const entry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      user: req.user?.id || "anonymous",
      env: env.NODE_ENV,
    };
    console.log(JSON.stringify(entry));
  });
  next();
};

module.exports = { logRequest };
