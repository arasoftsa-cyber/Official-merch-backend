const ADMIN_POLICY = Object.freeze({
  system: new Set([
    "admin:probe",
    "admin:ownership:write",
    "admin:domain:write",
  ]),
  dashboard: new Set(["admin_dashboard:read"]),
  self: new Set([
    "admin_dashboard:read",
    "catalog:product:create",
    "catalog:product:update",
  ]),
  orders: new Set(["admin_dashboard:read", "admin_dashboard:write"]),
  payments: new Set(["admin_dashboard:read"]),
  abuse_flags: new Set(["admin_dashboard:read"]),
  artists: new Set(["admin_dashboard:read", "admin_dashboard:write"]),
  product_variants: new Set(["admin_dashboard:read", "admin_dashboard:write"]),
  inventory_skus: new Set(["admin_dashboard:read", "admin_dashboard:write"]),
  test_support: new Set(["admin_dashboard:write"]),
  artist_access_requests: new Set(["admin_dashboard:read", "admin_dashboard:write"]),
  homepage_banners: new Set(["admin_dashboard:read", "admin_dashboard:write"]),
  media_assets: new Set(["admin_dashboard:write"]),
  drops: new Set(["admin_dashboard:read", "admin_dashboard:write"]),
});

const adminCan = (action, resource, _ctx) => {
  if (typeof action !== "string" || typeof resource !== "string") {
    return false;
  }

  const allowedActions = ADMIN_POLICY[resource];
  if (!allowedActions) {
    return false;
  }

  return allowedActions.has(action);
};

module.exports = { adminCan };
