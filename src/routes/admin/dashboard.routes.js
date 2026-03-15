const registerAdminDashboardRoutes = (router, deps) => {
  const {
    requireAuth,
    requirePolicy,
    ensureAdmin,
    listAdminLeads,
    getDb,
    formatDashboardSummary,
  } = deps;

  const handleAdminSummary = async (req, res, next) => {
    try {
      if (!ensureAdmin(req, res)) return;
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
    requirePolicy("admin_dashboard:read", "self"),
    handleAdminSummary
  );

  router.get(
    "/metrics",
    requireAuth,
    requirePolicy("admin_dashboard:read", "self"),
    handleAdminSummary
  );

  router.get("/leads", requireAuth, requirePolicy("admin_dashboard:read", "self"), async (req, res, next) => {
    try {
      const leads = await listAdminLeads();
      return res.json(leads);
    } catch (err) {
      return next(err);
    }
  });
};

module.exports = { registerAdminDashboardRoutes };
