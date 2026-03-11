"use strict";

const {
  TEMPLATE_BUILDERS,
  EMAIL_TIERS,
  EMAIL_TEMPLATE_CATALOG,
  listTemplateKeysByTier,
} = require("../src/services/emailTemplates");

describe("email template priority catalog", () => {
  it("contains catalog metadata for every registered template builder", () => {
    for (const key of Object.keys(TEMPLATE_BUILDERS)) {
      expect(EMAIL_TEMPLATE_CATALOG[key]).toBeTruthy();
    }
  });

  it("maps every live implemented catalog entry to a registered builder", () => {
    for (const [key, meta] of Object.entries(EMAIL_TEMPLATE_CATALOG)) {
      if (meta.implemented && meta.live) {
        expect(typeof TEMPLATE_BUILDERS[key]).toBe("function");
      }
    }
  });

  it("keeps Tier 1 live template set complete for current operational coverage", () => {
    const tier1Keys = listTemplateKeysByTier(EMAIL_TIERS.TIER_1);
    expect(tier1Keys).toEqual(
      expect.arrayContaining([
        "password-reset",
        "welcome-account",
        "email-verification",
        "partner-account-approved",
        "partner-account-rejected",
        "artist-access-request-received",
        "artist-access-request-approved",
        "artist-access-request-rejected",
        "order-confirmation",
        "order-status-processing",
        "order-status-shipped",
        "order-status-delivered",
        "order-status-cancelled",
        "order-status-refunded",
        "drop-quiz-lead-thank-you",
        "admin-notify-new-artist-access-request",
        "order-status-update",
        "shipment-dispatched",
        "admin-approved-account",
        "admin-rejected-account",
      ])
    );
  });
});
