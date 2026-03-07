const express = require("express");
const router = express.Router();


const authRoutes = require("./auth.routes");
const onboardingRoutes = require("./onboarding.routes");
const artistRoutes = require("./artist.routes");
const artistDashboardRoutes = require("./artist.dashboard.routes");
const catalogRouter = require("./catalog.routes");
const labelRoutes = require("./label.routes");
const labelDashboardRoutes = require("./label.dashboard.routes");
const dropsRouter = require("./drops.routes");
const ordersRouter = require("./orders.routes");
const adminOrdersRouter = require("./admin.orders.routes");
const paymentsRouter = require("./payments.routes");
const leadsRouter = require("./leads.routes");
const artistAccessRequestsRouter = require("./artistAccessRequests.routes");
const artistAccessRequestsAdminRouter = require("./artistAccessRequests.admin.routes");
const mediaAssetsRouter = require("./mediaAssets.routes");
const homepageRouter = require("./homepage.routes");
const adminHomepageRouter = require("./homepage.admin.routes");

router.use("/auth", authRoutes);
router.use("/admin/provisioning", onboardingRoutes);
router.use("/artists", artistRoutes);
router.use("/artist/dashboard", artistDashboardRoutes);
router.use("/catalog", catalogRouter);
router.use("/labels", labelRoutes);
router.use("/labels/dashboard", labelDashboardRoutes);
router.use("/drops", dropsRouter);
router.use("/orders", ordersRouter);
router.use("/payments", paymentsRouter);
router.use("/leads", leadsRouter);
router.use("/artist-access-requests", artistAccessRequestsRouter);
router.use("/media-assets", mediaAssetsRouter);
router.use("/homepage", homepageRouter);
router.use("/admin/homepage", adminHomepageRouter);
router.use("/admin", adminOrdersRouter);
router.use("/admin/artist-access-requests", artistAccessRequestsAdminRouter);

module.exports = router;