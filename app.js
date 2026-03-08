const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { getDb } = require("./src/core/db/db");
const { UPLOADS_DIR } = require("./src/core/config/paths");
const { ensureUploadDir } = require("./src/core/config/uploadPaths");
const { logRequest } = require("./src/core/http/logger");
const { attachAuthUser } = require("./src/core/http/auth.middleware");
const { requestId } = require("./src/core/http/requestId");
const { fail } = require("./src/core/http/errorResponse");
const router = require("./src/routes/index");
const cookieParser = require("cookie-parser");
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
app.use(cookieParser());
// 1. Define your allowed domains
const allowedOrigins = [
    'http://localhost:5173',
    process.env.CORS_ORIGINS,
];

// 2. Configure CORS options
const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
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

// 3. Apply the middleware
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
app.use("/uploads", express.static(UPLOADS_DIR));
ensureUploadDir("products");
app.use(attachAuthUser);
app.use(requestId);
app.use(logRequest);

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
  await ensureSeededUserRoles();
  await seedArtistAccessRequestsIfEmpty();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

startServer().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
