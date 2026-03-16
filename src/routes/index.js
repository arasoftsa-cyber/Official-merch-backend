const express = require("express");
const { requireAuth } = require("../core/http/auth.middleware");
const { requirePolicy } = require("../core/http/policy.middleware");
const { listAdminLeads } = require("../services/lead.service");
const router = express.Router();


const authRoutes = require("./auth.routes");
const onboardingRoutes = require("./onboarding.routes");
const artistRoutes = require("./artist.routes");
const artistDashboardRoutes = require("./dashboard.routes");
const catalogRouter = require("./catalog.routes");
const labelRoutes = require("./label.routes");
const labelDashboardRoutes = require("./labels-dashboard.routes");
const dropsRouter = require("./drops.routes");
const ordersRouter = require("./orders.routes");
const adminRouter = require("./admin.routes");
const paymentsRouter = require("./payments.routes");
const leadsRouter = require("./lead.routes");
const artistAccessRequestsRouter = require("./artistAccessRequests.routes");
const artistAccessRequestsAdminRouter = require("./artistAccessRequests.admin.routes");
const mediaAssetsRouter = require("./mediaAssets.routes");
const homepageRouter = require("./homepage.routes");
const adminHomepageRouter = require("./homepage.admin.routes");
const product = require("./productVariants.routes");
const configRouter = require("./config.routes");

const DASHBOARD_META = Object.freeze({
  artist: ["/api/artist/dashboard", "/api/artist/dashboard/orders"],
  label: ["/api/labels/dashboard", "/api/labels/dashboard/orders"],
  admin: ["/api/admin/dashboard/summary", "/api/admin/metrics"],
  buyer: ["/api/orders/my", "/api/orders/:id"],
});

router.get("/_meta/dashboards", (_req, res) => {
  res.json(DASHBOARD_META);
});
router.get("/partner/admin/leads", requireAuth, requirePolicy("admin_dashboard:read", "self"), async (_req, res, next) => {
  try {
    const leads = await listAdminLeads();
    return res.json(leads);
  } catch (err) {
    return next(err);
  }
});

router.use("/auth", authRoutes);
router.use("/config", configRouter);
router.use("/admin/provisioning", onboardingRoutes);
router.use("/artists", artistRoutes);
router.use("/artist/dashboard", artistDashboardRoutes);
router.use(catalogRouter);
router.use("/labels", labelRoutes);
router.use("/labels/dashboard", labelDashboardRoutes);
router.use("/label/dashboard", labelDashboardRoutes);
router.use("/drops", dropsRouter);
router.use("/admin/drops", dropsRouter);
router.use("/artist/drops", dropsRouter);
router.use("/orders", ordersRouter);
router.use("/payments", paymentsRouter);
router.use("/leads", leadsRouter);
router.use("/artist-access-requests", artistAccessRequestsRouter);
router.use("/media-assets", mediaAssetsRouter);
router.use("/homepage", homepageRouter);
router.use("/admin/homepage", adminHomepageRouter);
router.use("/admin", adminRouter);
router.use("/admin/artist-access-requests", artistAccessRequestsAdminRouter);
router.use(product);

module.exports = router;
