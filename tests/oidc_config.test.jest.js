"use strict";

describe("oidc config", () => {
  const ORIGINAL_ENV = process.env;

  const setupBaseEnv = () => {
    process.env = {
      ...ORIGINAL_ENV,
      OIDC_ENABLED: "true",
      OIDC_DISCOVERY_URL: "https://accounts.google.com/.well-known/openid-configuration",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_REDIRECT_URI: "http://localhost:3000/api/auth/oidc/google/callback",
      JWT_SECRET: "jwt-secret",
    };
  };

  beforeEach(() => {
    jest.resetModules();
    setupBaseEnv();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("uses configured redirect URI exactly when valid", () => {
    const oidcService = require("../src/services/oidc.service");
    const config = oidcService.getOidcConfig();

    expect(config.redirectUri).toBe(
      "http://localhost:3000/api/auth/oidc/google/callback"
    );
    expect(oidcService.OIDC_CALLBACK_PATH).toBe("/api/auth/oidc/google/callback");
  });

  it("rejects invalid callback paths with readable error", () => {
    process.env.OIDC_REDIRECT_URI = "http://localhost:3000/auth/callback";
    const oidcService = require("../src/services/oidc.service");

    expect(() => oidcService.getOidcConfig()).toThrow(
      "OIDC_REDIRECT_URI path must be exactly /api/auth/oidc/google/callback"
    );
  });
});
