"use strict";

jest.mock("openid-client", () => {
  const authorizationUrl = jest.fn(() => "https://accounts.google.com/o/oauth2/v2/auth");
  const discover = jest.fn().mockResolvedValue({
    Client: function Client() {
      return { authorizationUrl };
    },
  });

  return {
    Issuer: { discover },
    generators: { nonce: jest.fn(() => "nonce-123") },
    __mocks: { authorizationUrl, discover },
  };
});

describe("oidc start redirect URI", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      OIDC_ENABLED: "true",
      OIDC_DISCOVERY_URL: "https://accounts.google.com/.well-known/openid-configuration",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_REDIRECT_URI: "http://localhost:3000/api/auth/oidc/google/callback",
      JWT_SECRET: "jwt-secret",
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("passes exact configured redirect_uri to Google authorization URL", async () => {
    const oidcLib = require("openid-client");
    const oidcService = require("../src/services/oidc.service");

    await oidcService.buildGoogleAuthorizationUrl({
      req: { headers: { origin: "http://localhost:5173" } },
      portal: "fan",
      returnTo: "/fan",
    });

    expect(oidcLib.__mocks.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        redirect_uri: "http://localhost:3000/api/auth/oidc/google/callback",
      })
    );
  });
});
