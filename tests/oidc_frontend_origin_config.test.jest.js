"use strict";

describe("oidc frontend origin config", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      OIDC_ENABLED: "true",
      OIDC_DISCOVERY_URL: "https://accounts.google.com/.well-known/openid-configuration",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_REDIRECT_URI: "https://officialmerch.tech/api/auth/oidc/google/callback",
      JWT_SECRET: "jwt-secret",
      CORS_ORIGINS: "https://officialmerch.tech",
      NODE_ENV: "production",
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("fails loudly in production when public frontend origin env is missing", () => {
    delete process.env.OIDC_APP_BASE_URL;
    delete process.env.APP_PUBLIC_URL;
    delete process.env.UI_BASE_URL;
    delete process.env.FRONTEND_URL;
    delete process.env.CLIENT_URL;
    delete process.env.PUBLIC_URL;
    delete process.env.APP_URL;

    const oidcService = require("../src/services/oidc.service");
    expect(() => oidcService.getFrontendOidcConfig()).toThrow(
      "OIDC_APP_BASE_URL is required in production"
    );
  });

  it("rejects localhost public origin in production", () => {
    process.env.OIDC_APP_BASE_URL = "http://localhost:5173";
    const oidcService = require("../src/services/oidc.service");

    expect(() => oidcService.getFrontendOidcConfig()).toThrow(
      "Frontend public origin must not use localhost in production"
    );
  });

  it("accepts valid production frontend origin and callback path", () => {
    process.env.OIDC_APP_BASE_URL = "https://officialmerch.tech";
    process.env.OIDC_APP_CALLBACK_PATH = "/auth/oidc/callback";
    const oidcService = require("../src/services/oidc.service");

    const config = oidcService.getFrontendOidcConfig();
    expect(config.primaryOrigin).toBe("https://officialmerch.tech");
    expect(config.appCallbackPath).toBe("/auth/oidc/callback");
    expect(config.allowedOrigins).toContain("https://officialmerch.tech");
  });
});

