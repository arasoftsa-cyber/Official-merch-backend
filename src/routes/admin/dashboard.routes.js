const registerAdminDashboardRoutes = (router, deps) => {
  const {
    requireAuth,
    requirePolicy,
    listAdminLeads,
    getDb,
    formatDashboardSummary,
  } = deps;

  const requireAdminDashboardRead = requirePolicy("admin_dashboard:read", "dashboard");

  const handleAdminSummary = async (req, res, next) => {
    try {
      const db = getDb();
      const summary = await formatDashboardSummary(db);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  };

  router.get(
    "/dashboard/summary",
    requireAuth,
    requireAdminDashboardRead,
    handleAdminSummary
  );

  router.get(
    "/metrics",
    requireAuth,
    requireAdminDashboardRead,
    handleAdminSummary
  );

  router.get("/leads", requireAuth, requireAdminDashboardRead, async (req, res, next) => {
    try {
      const leads = await listAdminLeads();
      return res.json(leads);
    } catch (err) {
      return next(err);
    }
  });
};

module.exports = { registerAdminDashboardRoutes };
