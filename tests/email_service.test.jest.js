"use strict";

const { TEMPLATE_BUILDERS } = require("../src/services/emailTemplates");

describe("transactional email service", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      SENDGRID_API_KEY: "",
      SENDGRID_FROM_EMAIL: "",
      SENDGRID_FROM_NAME: "OfficialMerch",
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("skips safely when SendGrid config is missing", async () => {
    const emailService = require("../src/services/email.service");
    const result = await emailService.sendEmailByTemplate({
      templateKey: "welcome-account",
      to: "fan@example.com",
      payload: {
        appUrl: "https://officialmerch.tech",
        loginUrl: "https://officialmerch.tech/fan/login",
      },
    });

    expect(result.skipped).toBe(true);
    expect(result.errorCode).toBe("EMAIL_MISCONFIGURED");
  });

  it("can render and attempt send for every template key before misconfiguration fallback", async () => {
    const emailService = require("../src/services/email.service");
    const keys = Object.keys(TEMPLATE_BUILDERS);

    for (const key of keys) {
      const result = await emailService.sendEmailByTemplate({
        templateKey: key,
        to: "fan@example.com",
        payload: {
          resetUrl: "https://officialmerch.tech/reset-password?token=abc123",
          verificationUrl: "https://officialmerch.tech/verify-email?token=verify123",
          loginUrl: "https://officialmerch.tech/partner/login",
          appUrl: "https://officialmerch.tech",
          orderUrl: "https://officialmerch.tech/fan/orders/ORD-12345",
          orderId: "ORD-12345",
          orderNumber: "ORD-12345",
          status: "paid",
          trackingUrl: "https://carrier.example/track/TRACK-123",
          customerName: "Alex",
          accountName: "Alex",
          applicantName: "Alex",
        },
      });

      expect(result.errorCode).toBe("EMAIL_MISCONFIGURED");
      expect(result.skipped).toBe(true);
    }
  });
});
