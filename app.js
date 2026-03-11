const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const env = require("./src/core/config/env");
const { getDb } = require("./src/core/db/db");
const { UPLOADS_DIR } = require("./src/core/config/paths");
const { ensureUploadDir } = require("./src/core/config/uploadPaths");
const { logRequest } = require("./src/core/http/logger");
const { attachAuthUser } = require("./src/core/http/auth.middleware");
const { requestId } = require("./src/core/http/requestId");
const { fail } = require("./src/core/http/errorResponse");
const { getEmailConfigReadiness } = require("./src/services/email.service");
const {
  frontendOrigin,
  backendBaseUrl,
  getOriginConfigReadiness,
} = require("./src/config/appOrigin");
const createHealthRouter = require("./src/routes/health.routes");
const router = require("./src/routes/index");
const app = express();
const PORT = process.env.PORT || 3000;
const BODY_SIZE_LIMIT = process.env.BODY_SIZE_LIMIT || "2mb";
const isProduction = process.env.NODE_ENV === "production";
const DEBUG_STARTUP = /^(1|true|yes|on)$/i.test(String(process.env.DEBUG_STARTUP || "").trim());
const logStartupDebug = (...args) => {
  if (DEBUG_STARTUP) {
    console.log(...args);
  }
};
const corsOptions = {
  origin: frontendOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-Request-ID",
    "Cache-Control",
    "If-None-Match",
  ],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  hsts: isProduction ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false,
}));
app.use(express.json({ limit: BODY_SIZE_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));

app.use((req, res, next) => {
  const ensureJsonUtf8ContentType = () => {
    const current = res.getHeader("Content-Type");
    if (!current) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return;
    }

    const value = Array.isArray(current) ? current.join("; ") : String(current);
    const isJsonLike = /(^|;)\s*application\/(?:[a-z0-9.+-]+\+)?json\b/i.test(value);
    const hasCharset = /;\s*charset=/i.test(value);
    if (isJsonLike && !hasCharset) {
      res.setHeader("Content-Type", `${value}; charset=utf-8`);
    }
  };

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    ensureJsonUtf8ContentType();
    return originalJson(body);
  };

  if (typeof res.jsonp === "function") {
    const originalJsonp = res.jsonp.bind(res);
    res.jsonp = (body) => {
      ensureJsonUtf8ContentType();
      return originalJsonp(body);
    };
  }

  next();
});

app.use("/uploads", express.static(UPLOADS_DIR));
ensureUploadDir("products");
app.use(attachAuthUser);
app.use(requestId);
app.use(logRequest);

app.use(
  "/api",
  createHealthRouter({
    getDb,
    getEmailConfigReadiness,
    getOriginConfigReadiness,
  })
);
app.use("/api", router);

app.use((err, req, res, next) => {
  void next;
  const status = res.statusCode && res.statusCode >= 400 ? res.statusCode : 500;
  console.error(
    `[${req.method}] ${req.originalUrl} -> ${status}`,
    err.stack || err
  );
  const message =
    process.env.NODE_ENV === "production"
      ? "An unexpected error occurred"
      : err?.message || "An unexpected error occurred";
  return fail(res, status, "internal_server_error", message);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});


const seedArtistAccessRequestsIfEmpty = async () => {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const db = getDb();
    const countResult = await db.raw(
      'select count(*)::int as count from artist_access_requests'
    );
    const count =
      (countResult?.rows?.[0]?.count ?? countResult?.[0]?.count ?? 0) || 0;
    if (count > 0) {
      logStartupDebug("artist_access_requests already seeded:", count);
      return;
    }
    logStartupDebug("Seeding artist_access_requests...");
    const seedData = [
      {
        artist_name: "Midnight Echo",
        handle: "midnight-echo",
        contact_email: "echo@example.com",
        contact_phone: "9991112222",
        socials: { instagram: "https://instagram.com/midnightecho" },
        pitch: "We are an indie rock band.",
      },
      {
        artist_name: "Solar Drift",
        handle: "solar-drift",
        contact_email: "solar@example.com",
        contact_phone: "9993334444",
        socials: { instagram: "https://instagram.com/solardrift" },
        pitch: "Electronic fusion collective.",
      },
      {
        artist_name: "Crimson Wave",
        handle: "crimson-wave",
        contact_email: "wave@example.com",
        contact_phone: "9995556666",
        socials: { instagram: "https://instagram.com/crimsonwave" },
        pitch: "Alt-pop duo from Berlin.",
      },
    ];
    for (const row of seedData) {
      await db.raw(
        `
        insert into artist_access_requests
        (artist_name, handle, contact_email, contact_phone, socials, pitch, status, created_at)
        values ($1,$2,$3,$4,$5,$6,'pending',now())
        `,
        [
          row.artist_name,
          row.handle,
          row.contact_email,
          row.contact_phone,
          JSON.stringify(row.socials),
          row.pitch,
        ]
      );
    }
    logStartupDebug("Seeded artist_access_requests successfully.");
  } catch (err) {
    console.error("Seed failed:", err);
  }
};

const ensureRequiredAuthSecrets = () => {
  if (process.env.NODE_ENV === "test") return;

  const requiredSecrets = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
  const missingSecrets = requiredSecrets.filter(
    (envKey) => !String(process.env[envKey] || "").trim()
  );

  if (missingSecrets.length === 0) return;

  const readableList = missingSecrets.map((envKey) => `- ${envKey}`).join("\n");
  console.error(`Missing required auth secrets:\n${readableList}`);
  throw new Error(
    `Missing required auth secrets: ${missingSecrets.join(", ")}`
  );
};

const ensureRefreshSecretSeparation = () => {
  if (process.env.NODE_ENV === "test") return;

  const refreshSecret = String(process.env.JWT_REFRESH_SECRET || "").trim();
  const accessSecret = String(
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || ""
  ).trim();

  if (!refreshSecret || !accessSecret) return;
  if (refreshSecret !== accessSecret) return;

  const message =
    "JWT_REFRESH_SECRET must be different from the access/token signing secret";
  console.error(`[startup] ${message}`);
  throw new Error(message);
};

const ensureSeededUserRoles = async () => {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const db = getDb();
    await Promise.all([
      db("users")
        .where({ id: "00000000-0000-0000-0000-000000000001" })
        .update({ role: "admin" }),
      db("users")
        .where({ id: "00000000-0000-0000-0000-000000000002" })
        .update({ role: "buyer" }),
      db("users")
        .where({ id: "00000000-0000-0000-0000-000000000003" })
        .update({ role: "artist" }),
      db("users")
        .where({ id: "00000000-0000-0000-0000-000000000004" })
        .update({ role: "label" }),
    ]);
    await db.destroy();
  } catch (err) {
    console.error("Failed to normalize seeded user roles", err);
  }
};

const startServer = async () => {
  ensureRequiredAuthSecrets();
  ensureRefreshSecretSeparation();

  const originReadiness =
    typeof getOriginConfigReadiness === "function"
      ? getOriginConfigReadiness()
      : { ready: false, missing: ["origin_config_unavailable"] };
  if (originReadiness.ready === false) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `[startup] missing required origin config: ${originReadiness.missing.join(", ")}`
      );
    }
    console.warn("[startup] origin config incomplete", {
      missing: originReadiness.missing,
      frontendOrigin: originReadiness.frontendOrigin || null,
      backendBaseUrl: originReadiness.backendBaseUrl || null,
    });
  }

  const emailReadiness = getEmailConfigReadiness();
  const envDiagnostics =
    typeof env.getEnvDiagnostics === "function"
      ? env.getEnvDiagnostics()
      : { loadedFiles: [] };
  console.log("[startup] email config readiness", {
    configured: emailReadiness.configured,
    apiKeyPresent: emailReadiness.apiKeyPresent,
    fromEmailPresent: emailReadiness.fromEmailPresent,
    fromNamePresent: emailReadiness.fromNamePresent,
    envFiles: envDiagnostics.loadedFiles,
    originReady: originReadiness.ready,
    originMissing: originReadiness.missing,
  });
  if (!emailReadiness.configured) {
    console.warn("[startup] transactional email disabled (missing env)", {
      missingRequired: emailReadiness.missingRequired,
      missingOptional: emailReadiness.missingOptional,
    });
  }

  await ensureSeededUserRoles();
  await seedArtistAccessRequestsIfEmpty();
  const server = app.listen(PORT, () => {
    const runningUrl = backendBaseUrl || `http://0.0.0.0:${PORT}`;
    console.log(`Server running on ${runningUrl}`);
  });
  return server;
};

// Start the server only if this file is run directly
if (require.main === module) {
  startServer().catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
  });
}

// Export the app for testing
module.exports = app;
