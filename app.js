const express = require("express");
let cors;
try {
  cors = require("cors");
} catch (err) {
  cors = null;
  console.warn("cors module not available; falling back to inline middleware");
}
const authRoutes = require("./src/modules/auth/auth.routes");
const onboardingRoutes = require("./src/modules/onboarding/onboarding.routes");
const artistRoutes = require("./src/modules/artists/artist.routes");
const artistDashboardRoutes = require("./src/modules/artists/dashboard.routes");
const catalogRouter = require("./src/modules/catalog/catalog.routes");
const labelRoutes = require("./src/modules/labels/label.routes");
const labelDashboardRoutes = require("./src/modules/labels/dashboard.routes");
const dropsRouter = require("./src/modules/drops/drops.routes");
const ordersRouter = require("./src/modules/orders/orders.routes");
const adminOrdersRouter = require("./src/modules/orders/admin.routes");
const paymentsRouter = require("./src/modules/payments/payments.routes");
const leadsRouter = require("./src/modules/leads/lead.routes");
const artistAccessRequestsRouter = require("./src/modules/artistAccessRequests/artistAccessRequests.routes");
const artistAccessRequestsAdminRouter = require("./src/modules/artistAccessRequests/artistAccessRequests.admin.routes");
const devRouter = require("./routes/dev.routes");
const { getDb } = require("./src/config/db");
const { logRequest } = require("./src/middleware/logger");
const { attachAuthUser } = require("./src/middleware/auth.middleware");

const app = express();
const PORT = process.env.PORT || 3000;
const BUILD_ID = process.env.BUILD_ID || new Date().toISOString();
console.log("### BACKEND BUILD ID ###", BUILD_ID, "pid=", process.pid);
console.log("BUILD_ID Value:", BUILD_ID);
const deprecateMiddleware = (message) => (req, _res, next) => {
  console.warn(`[DEPRECATION] ${message}`);
  next();
};
const aliasDeprecationHeaders = ({ sunset, link }) => (req, res, next) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", sunset);
  if (link) {
    res.setHeader("Link", `<${link}>; rel="alternate"`);
  }
  next();
};
const legacyLabelPrefixWarning = (req, _res, next) => {
  console.warn(
    `[deprecation] Legacy label prefix used: ${req.method} ${req.originalUrl}. Use /api/labels/* instead.`
  );
  next();
};

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://76.13.241.27:5173",
  process.env.CLIENT_URL,
].filter(Boolean));

const corsOptions = {
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cache-Control", "If-None-Match"],
  credentials: true,
};

app.use(express.json());
app.use(cors(corsOptions));
app.use(attachAuthUser);
app.use(logRequest);

app.use((req, res, next) => {
  res.setHeader("X-Build", BUILD_ID);
  next();
});

const mountedRoutes = [];

mountedRoutes.push("/api/auth");
app.use("/api/auth", authRoutes);

mountedRoutes.push("/api/admin/provisioning");
app.use("/api/admin/provisioning", onboardingRoutes);

mountedRoutes.push("/api/artists");
app.use("/api/artists", artistRoutes);

mountedRoutes.push("/api/artist/dashboard");
app.use("/api/artist/dashboard", artistDashboardRoutes);
mountedRoutes.push("/api (catalog)");
app.use("/api", catalogRouter);

mountedRoutes.push("/api/labels");
app.use("/api/labels", labelRoutes);

mountedRoutes.push("/api/labels/dashboard");
app.use("/api/labels/dashboard", labelDashboardRoutes);
mountedRoutes.push("/api/labels");
app.use("/api/labels", labelDashboardRoutes);
mountedRoutes.push("/api/label/dashboard (alias)");
app.use(
  "/api/label/dashboard",
  aliasDeprecationHeaders({
    sunset: "2026-04-16T00:00:00.000Z",
    link: "/api/labels/dashboard",
  }),
  legacyLabelPrefixWarning,
  labelDashboardRoutes
);
mountedRoutes.push("/api/label (alias)");
app.use(
  "/api/label",
  aliasDeprecationHeaders({
    sunset: "2026-04-16T00:00:00.000Z",
    link: "/api/labels",
  }),
  legacyLabelPrefixWarning,
  labelDashboardRoutes
);
mountedRoutes.push("/api/drops");
app.use("/api/drops", dropsRouter);
mountedRoutes.push("/api/artist/drops");
app.use("/api/artist/drops", dropsRouter);
mountedRoutes.push("/api/admin/drops");
app.use("/api/admin/drops", dropsRouter);

mountedRoutes.push("/api/orders");
app.use("/api/orders", ordersRouter);

mountedRoutes.push("/api/admin");
app.use("/api/admin", adminOrdersRouter);

mountedRoutes.push("/api/payments");
app.use("/api/payments", paymentsRouter);

mountedRoutes.push("/api/leads");
app.use("/api/leads", leadsRouter);

const productVariantsRouter = require("./src/modules/catalog/productVariants.routes");
mountedRoutes.push("/api/products");
app.use("/api", productVariantsRouter);

mountedRoutes.push("/api/artist-access-requests");
app.use("/api/artist-access-requests", artistAccessRequestsRouter);

mountedRoutes.push("/api/admin/artist-access-requests");
app.use("/api/admin/artist-access-requests", artistAccessRequestsAdminRouter);

mountedRoutes.push("/api/dev");
app.use("/api", devRouter);

app.get("/api/_meta/dashboards", (req, res) => {
  res.json({
    artist: ["/api/artist/dashboard/summary", "/api/artist/dashboard/orders"],
    label: ["/api/labels/dashboard/summary", "/api/labels/dashboard/orders"],
    admin: ["/api/admin/dashboard/summary", "/api/admin/dashboard/orders"],
    buyer: ["/api/orders/my", "/api/orders/:id", "/api/orders/:id/events"],
  });
});

let hasLoggedPartnerAdminLeadsSql = false;
const ALLOWED_LEAD_STATUSES = new Set(["new", "contacted", "converted", "ignored"]);

const listAdminLeads = async (req, res, next) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    const db = getDb();
    const source =
      typeof req.query.source === "string" && req.query.source.trim().length > 0
        ? req.query.source.trim()
        : null;

    const query = db("leads")
      .select(
        "id",
        "source",
        "drop_handle",
        "name",
        "email",
        "phone",
        "status",
        "admin_note",
        "created_at",
        "updated_at",
        db.raw("COALESCE((answers_json->>'score')::int, 0) AS score"),
        db.raw("COALESCE((answers_json->>'maxScore')::int, 0) AS \"maxScore\"")
      )
      .orderByRaw("COALESCE((answers_json->>'score')::int, 0) DESC NULLS LAST")
      .orderBy("created_at", "desc");

    if (source) {
      query.where("source", source);
    }

    if (!hasLoggedPartnerAdminLeadsSql) {
      hasLoggedPartnerAdminLeadsSql = true;
      const sqlPreview = query.clone().toSQL().toNative();
      console.log("[admin leads sql]", sqlPreview.sql, sqlPreview.bindings);
    }

    const rows = await query;

    return res.json(
      rows.map((row) => ({
        id: row.id,
        source: row.source,
        drop_handle: row.drop_handle,
        name: row.name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        admin_note: row.admin_note,
        created_at: row.created_at,
        updated_at: row.updated_at,
        score: row.score,
        maxScore: row.maxScore,
      }))
    );
  } catch (err) {
    next(err);
  }
};

const patchAdminLead = async (req, res, next) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    const leadId = req.params.id;
    if (!leadId) {
      return res.status(400).json({ error: "invalid_request" });
    }

    const { status, adminNote } = req.body || {};
    const updates = {};

    if (typeof status !== "undefined") {
      const normalizedStatus = String(status).trim().toLowerCase();
      if (!ALLOWED_LEAD_STATUSES.has(normalizedStatus)) {
        return res.status(400).json({
          error: "invalid_status",
          allowed: Array.from(ALLOWED_LEAD_STATUSES),
        });
      }
      updates.status = normalizedStatus;
    }

    if (typeof adminNote !== "undefined") {
      updates.admin_note = adminNote ? String(adminNote) : null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "invalid_request" });
    }

    updates.updated_at = getDb().fn.now();

    const db = getDb();
    const updated = await db("leads")
      .where({ id: leadId })
      .update(updates)
      .returning([
        "id",
        "source",
        "drop_handle",
        "name",
        "email",
        "phone",
        "status",
        "admin_note",
        "created_at",
        "updated_at",
      ]);

    const row = Array.isArray(updated) ? updated[0] : null;
    if (!row) {
      return res.status(404).json({ error: "lead_not_found" });
    }

    return res.json({
      id: row.id,
      source: row.source,
      drop_handle: row.drop_handle,
      name: row.name,
      email: row.email,
      phone: row.phone,
      status: row.status,
      admin_note: row.admin_note,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (err) {
    next(err);
  }
};

const adminLeadsRouter = express.Router();
adminLeadsRouter.get("/", listAdminLeads);
adminLeadsRouter.patch("/:id", express.json(), patchAdminLead);

mountedRoutes.push("/api/admin/leads");
app.use("/api/admin/leads", adminLeadsRouter);
mountedRoutes.push("/api/partner/admin/leads (alias)");
app.use(
  "/api/partner/admin/leads",
  aliasDeprecationHeaders({
    sunset: "2026-04-16T00:00:00.000Z",
    link: "/api/admin/leads",
  }),
  deprecateMiddleware("/api/partner/admin/leads -> /api/admin/leads"),
  adminLeadsRouter
);

app.use((err, req, res, next) => {
  const status = res.statusCode && res.statusCode >= 400 ? res.statusCode : 500;
  res.status(status);
  console.error(
    `[${req.method}] ${req.originalUrl} -> ${status}`,
    err.stack || err
  );
  res.json({
    error: "internal_server_error",
    message: err?.message || "An unexpected error occurred",
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

app.get("/__routes", (req, res) => {
  res.json({
    ok: true,
    port: PORT,
    hasAuthRoutes: mountedRoutes.includes("/api/auth"),
    mountedRoutes,
    notes: "If hasAuthRoutes=false then /api/auth is not mounted in this running server",
  });
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
      console.log("artist_access_requests already seeded:", count);
      return;
    }
    console.log("Seeding artist_access_requests...");
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
    console.log("Seeded artist_access_requests successfully.");
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
