const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { requireAuth } = require("../core/http/auth.middleware");
const { requirePolicy } = require("../core/http/policy.middleware");
const { listFlags } = require("../utils/abuseFlags");
const { listAdminLeads } = require("../services/lead.service");

const { ensureAdmin } = require("./admin/shared/ensureAdmin");
const { formatDashboardSummary } = require("./admin/dashboard.helpers");
const {
  REGISTER_TEST_SEED_ROUTES,
  TEST_SEEDS_ENABLED,
  TEST_BUYER_ID,
  MAX_SEEDED_ORDERS,
  ensureArtistForSeed,
  ensureProductVariantForSeed,
} = require("./admin/seed.helpers");
const {
  ORDER_NOT_FOUND,
  ORDER_NOT_FULFILLABLE,
  ORDER_NOT_PAID,
  ORDER_NOT_REFUNDABLE,
  formatItem,
  formatOrder,
  formatEvent,
  sendShipmentDispatchedEmailBestEffort,
  sendOrderStatusUpdateEmailBestEffort,
} = require("./admin/orders.helpers");

const { registerAdminDashboardRoutes } = require("./admin/dashboard.routes");
const { registerAdminSeedRoutes } = require("./admin/seed.routes");
const { registerAdminOrderRoutes } = require("./admin/orders.routes");
const { registerAdminPaymentRoutes } = require("./admin/payments.routes");
const { registerAdminArtistRoutes, __test: adminArtistRoutesTest } = require("./admin/artist/routes");

const router = express.Router();
const PAYMENT_NOT_FOUND = { error: "payment_not_found" };

registerAdminDashboardRoutes(router, {
  requireAuth,
  requirePolicy,
  ensureAdmin,
  listAdminLeads,
  getDb,
  formatDashboardSummary,
});

registerAdminSeedRoutes(router, {
  REGISTER_TEST_SEED_ROUTES,
  requireAuth,
  express,
  TEST_SEEDS_ENABLED,
  ensureAdmin,
  MAX_SEEDED_ORDERS,
  getDb,
  ensureArtistForSeed,
  ensureProductVariantForSeed,
  randomUUID,
  TEST_BUYER_ID,
});

registerAdminOrderRoutes(router, {
  requireAuth,
  requirePolicy,
  ensureAdmin,
  getDb,
  formatOrder,
  formatItem,
  formatEvent,
  ORDER_NOT_FOUND,
  ORDER_NOT_FULFILLABLE,
  ORDER_NOT_PAID,
  ORDER_NOT_REFUNDABLE,
  sendShipmentDispatchedEmailBestEffort,
  sendOrderStatusUpdateEmailBestEffort,
});

registerAdminPaymentRoutes(router, {
  requireAuth,
  ensureAdmin,
  getDb,
  PAYMENT_NOT_FOUND,
  listFlags,
});

registerAdminArtistRoutes(router, {
  ensureAdmin,
});

module.exports = router;
module.exports.__test = {
  fetchActiveArtistSubscriptionPayload: adminArtistRoutesTest.fetchActiveArtistSubscriptionPayload,
  updateArtistSubscriptionAction: adminArtistRoutesTest.updateArtistSubscriptionAction,
  reconcileArtistUserMapping: adminArtistRoutesTest.reconcileArtistUserMapping,
};
