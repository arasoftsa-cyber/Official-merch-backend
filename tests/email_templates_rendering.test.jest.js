"use strict";

const {
  TEMPLATE_BUILDERS,
  renderEmailTemplate,
  EMAIL_TEMPLATE_CATALOG,
} = require("../src/services/emailTemplates");

const REQUIRED_TEMPLATE_KEYS = Object.freeze([
  "welcome-account",
  "password-reset",
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
  "contact-form-received",
  "admin-notify-new-artist-access-request",
]);

const MINIMAL_PAYLOADS = Object.freeze({
  "welcome-account": {
    loginUrl: "https://officialmerch.tech/fan/login",
  },
  "password-reset": {
    resetUrl: "https://officialmerch.tech/reset-password?token=abc123",
    expiresInMinutes: 60,
  },
  "email-verification": {
    customerName: "Alex",
    verificationUrl: "https://officialmerch.tech/verify-email?token=verify123",
    expiresInMinutes: 30,
  },
  "partner-account-approved": {
    accountName: "Solar Label",
    loginUrl: "https://officialmerch.tech/partner/login",
  },
  "partner-account-rejected": {
    accountName: "Solar Label",
    rejectionReason: "We need additional verification details.",
    supportUrl: "https://officialmerch.tech/support",
  },
  "artist-access-request-received": {
    applicantName: "Echo Artist",
    requestReference: "AAR-123",
    submittedAt: "2026-03-10T09:30:00.000Z",
    reviewStatus: "pending",
    dashboardUrl: "https://officialmerch.tech/partner/requests/AAR-123",
  },
  "artist-access-request-approved": {
    applicantName: "Echo Artist",
    artistName: "Echo Artist",
    requestReference: "AAR-123",
    loginUrl: "https://officialmerch.tech/partner/login",
  },
  "artist-access-request-rejected": {
    applicantName: "Echo Artist",
    requestReference: "AAR-123",
    rejectionReason: "Profile details were incomplete.",
    reapplyUrl: "https://officialmerch.tech/apply/artist",
  },
  "order-confirmation": {
    customerName: "Alex",
    orderNumber: "ORD-12345",
    orderDate: "2026-03-10T10:00:00.000Z",
    currency: "USD",
    items: [
      {
        title: "Official Tee",
        size: "M",
        color: "Black",
        qty: 1,
        priceCents: 2599,
      },
    ],
    subtotalCents: 2599,
    shippingCents: 499,
    discountCents: 0,
    totalCents: 3098,
    shippingAddress: {
      name: "Alex",
      line1: "123 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "US",
    },
    orderUrl: "https://officialmerch.tech/fan/orders/ORD-12345",
  },
  "order-status-processing": {
    customerName: "Alex",
    orderNumber: "ORD-12345",
    currency: "USD",
    totalCents: 3098,
    orderUrl: "https://officialmerch.tech/fan/orders/ORD-12345",
  },
  "order-status-shipped": {
    customerName: "Alex",
    orderNumber: "ORD-12345",
    currency: "USD",
    totalCents: 3098,
    trackingNumber: "TRACK-123",
    trackingUrl: "https://carrier.example/track/TRACK-123",
    orderUrl: "https://officialmerch.tech/fan/orders/ORD-12345",
  },
  "order-status-delivered": {
    customerName: "Alex",
    orderNumber: "ORD-12345",
    currency: "USD",
    totalCents: 3098,
    orderUrl: "https://officialmerch.tech/fan/orders/ORD-12345",
  },
  "order-status-cancelled": {
    customerName: "Alex",
    orderNumber: "ORD-12345",
    currency: "USD",
    totalCents: 3098,
    orderUrl: "https://officialmerch.tech/fan/orders/ORD-12345",
  },
  "order-status-refunded": {
    customerName: "Alex",
    orderNumber: "ORD-12345",
    currency: "USD",
    totalCents: 3098,
    orderUrl: "https://officialmerch.tech/fan/orders/ORD-12345",
  },
  "drop-quiz-lead-thank-you": {
    customerName: "Alex",
    dropName: "Spring Drop",
    artistName: "Echo Artist",
    dropUrl: "https://officialmerch.tech/drops/spring-drop",
    followUpWindowHours: 48,
  },
  "contact-form-received": {
    customerName: "Alex",
    ticketId: "SUP-1001",
    submittedAt: "2026-03-10T11:00:00.000Z",
    supportUrl: "https://officialmerch.tech/support",
  },
  "admin-notify-new-artist-access-request": {
    applicantName: "Echo Artist",
    requestReference: "AAR-123",
    submittedAt: "2026-03-10T09:30:00.000Z",
    requesterEmail: "echo@example.com",
    requestedPlanType: "basic",
    reviewUrl: "https://officialmerch.tech/admin/artist-requests/AAR-123",
  },

  // Legacy keys still mapped in active runtime.
  "order-status-update": {
    customerName: "Alex",
    orderId: "ORD-12345",
    status: "paid",
    message: "Your payment was received and your order is confirmed.",
    orderUrl: "https://officialmerch.tech/fan/orders/ORD-12345",
  },
  "shipment-dispatched": {
    customerName: "Alex",
    orderId: "ORD-12345",
    carrier: "DHL",
    trackingNumber: "TRACK-123",
    trackingUrl: "https://carrier.example/track/TRACK-123",
    orderUrl: "https://officialmerch.tech/fan/orders/ORD-12345",
  },
  "admin-approved-account": {
    accountName: "Echo Artist",
    loginUrl: "https://officialmerch.tech/partner/login",
    appUrl: "https://officialmerch.tech",
  },
  "admin-rejected-account": {
    accountName: "Echo Artist",
    reason: "Your request is missing required details.",
    appUrl: "https://officialmerch.tech/apply/artist",
  },
});

describe("email template rendering coverage", () => {
  it("contains all required transactional template keys in active builders", () => {
    expect(Object.keys(TEMPLATE_BUILDERS)).toEqual(expect.arrayContaining(REQUIRED_TEMPLATE_KEYS));
  });

  it("marks required transactional templates as implemented and live in catalog", () => {
    for (const key of REQUIRED_TEMPLATE_KEYS) {
      const entry = EMAIL_TEMPLATE_CATALOG[key];
      expect(entry).toBeTruthy();
      expect(entry.implemented).toBe(true);
      expect(entry.live).toBe(true);
      expect(Array.isArray(entry.payload?.required)).toBe(true);
      expect(Array.isArray(entry.payload?.optional)).toBe(true);
    }
  });

  it("renders subject, html, and text for every registered template without unresolved placeholders", () => {
    for (const key of Object.keys(TEMPLATE_BUILDERS)) {
      const payload = MINIMAL_PAYLOADS[key] || {};
      const rendered = renderEmailTemplate({ templateKey: key, payload });

      expect(rendered.subject).toBeTruthy();
      expect(typeof rendered.subject).toBe("string");
      expect(typeof rendered.text).toBe("string");
      expect(typeof rendered.html).toBe("string");
      expect(rendered.text.length > 0 || rendered.html.length > 0).toBe(true);

      const body = `${rendered.subject}\n${rendered.text}\n${rendered.html}`;
      expect(body).not.toMatch(/{{\s*[\w.-]+\s*}}/);
      expect(body).not.toMatch(/\bundefined\b/i);
      expect(body).not.toMatch(/\bnull\b/i);
    }
  });

  it("handles optional fields gracefully without empty CTA blocks", () => {
    const rejected = renderEmailTemplate({
      templateKey: "artist-access-request-rejected",
      payload: {
        applicantName: "Echo Artist",
      },
    });
    expect(rejected.text).not.toContain("Reason:");
    expect(rejected.html).not.toContain("<a href=");

    const shipped = renderEmailTemplate({
      templateKey: "order-status-shipped",
      payload: {
        customerName: "Alex",
        orderNumber: "ORD-12345",
      },
    });
    expect(shipped.text).not.toContain("Tracking link:");
    expect(shipped.html).not.toContain("<a href=");
  });
});
