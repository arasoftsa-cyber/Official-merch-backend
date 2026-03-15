"use strict";

const express = require("express");
const request = require("supertest");

describe("health readiness email mode", () => {
  const ORIGINAL_ENV = process.env;

  const createApp = ({
    env = {},
    dbShouldFail = false,
    originReady = true,
  } = {}) => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      SENDGRID_API_KEY: "",
      SENDGRID_FROM_EMAIL: "",
      SENDGRID_FROM_NAME: "",
      EMAIL_REQUIRED: "false",
      ...env,
    };

    const createHealthRouter = require("../src/routes/health.routes");
    const { getEmailConfigReadiness } = require("../src/services/email.service");

    const app = express();
    app.use(
      "/api",
      createHealthRouter({
        getDb: () => ({
          raw: async () => {
            if (dbShouldFail) {
              throw new Error("sensitive_db_connection_error");
            }
            return [{ ok: 1 }];
          },
        }),
        getEmailConfigReadiness,
        getOriginConfigReadiness: () =>
          originReady
            ? { ready: true, missing: [] }
            : { ready: false, missing: ["frontendOrigin"] },
      })
    );
    return app;
  };

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("treats unconfigured email as non-blocking when email is optional", async () => {
    const app = createApp();

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.ready).toBe(true);
    expect(response.body.status).toBe("ok");
    expect(response.body.warnings).toContain("email_optional_not_configured");
    expect(response.body.checks.emailConfig.status).toBe("optional_not_configured");
    expect(response.body.checks.emailConfig.required).toBe(false);
  });

  it("fails readiness when email is explicitly required but unconfigured", async () => {
    const app = createApp({
      env: {
        EMAIL_REQUIRED: "true",
      },
    });

    const response = await request(app).get("/api/health/ready");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("degraded");
    expect(response.body.blockingChecks.emailConfig.required).toBe(true);
    expect(response.body.blockingChecks.emailConfig.blocking).toBe(true);
    expect(response.body.blockingChecks.emailConfig.status).toBe("required_not_configured");
  });

  it("keeps liveness green even when required email is not configured", async () => {
    const app = createApp({
      env: {
        EMAIL_REQUIRED: "true",
      },
    });

    const response = await request(app).get("/api/health/live");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.checks.emailConfig.required).toBe(true);
    expect(response.body.checks.emailConfig.blocking).toBe(true);
  });

  it("reports configured email as healthy on readiness", async () => {
    const app = createApp({
      env: {
        SENDGRID_API_KEY: "sg-key",
        SENDGRID_FROM_EMAIL: "no-reply@example.com",
        SENDGRID_FROM_NAME: "OfficialMerch",
      },
    });

    const response = await request(app).get("/api/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.blockingChecks.emailConfig.status).toBe("configured");
    expect(response.body.warnings).toEqual([]);
  });

  it("does not leak raw internal db errors in health responses", async () => {
    const app = createApp({ dbShouldFail: true });

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(503);
    expect(response.body.checks.db.error).toBe("db_ping_failed");
    expect(JSON.stringify(response.body)).not.toContain("sensitive_db_connection_error");
  });
});
