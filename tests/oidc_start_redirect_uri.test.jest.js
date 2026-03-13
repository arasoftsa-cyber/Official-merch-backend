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
      NODE_ENV: "test",
      OIDC_ENABLED: "true",
      OIDC_DISCOVERY_URL: "https://accounts.google.com/.well-known/openid-configuration",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_REDIRECT_URI: "http://localhost:3000/api/auth/oidc/google/callback",
      OIDC_APP_BASE_URL: "http://localhost:5173",
      CORS_ORIGINS: "http://localhost:5173",
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

  it("rejects invalid portal value with canonical contract code", async () => {
    const oidcService = require("../src/services/oidc.service");
    await expect(
      oidcService.buildGoogleAuthorizationUrl({
        req: { headers: { origin: "http://localhost:5173" } },
        portal: "unknown",
        returnTo: "/fan",
      })
    ).rejects.toMatchObject({ code: "invalid_portal" });
  });

  it("rejects invalid returnTo value with canonical contract code", async () => {
    const oidcService = require("../src/services/oidc.service");
    await expect(
      oidcService.buildGoogleAuthorizationUrl({
        req: { headers: { origin: "http://localhost:5173" } },
        portal: "fan",
        returnTo: "https://evil.example",
      })
    ).rejects.toMatchObject({ code: "invalid_return_to" });
  });

  it("rejects non-allowlisted appOrigin with canonical contract code", async () => {
    const oidcService = require("../src/services/oidc.service");
    await expect(
      oidcService.buildGoogleAuthorizationUrl({
        req: { headers: { origin: "http://localhost:5173" } },
        portal: "fan",
        returnTo: "/fan",
        appOrigin: "https://evil.example",
      })
    ).rejects.toMatchObject({ code: "invalid_origin" });
  });

  it("rejects invalid state token with canonical contract code", () => {
    const oidcService = require("../src/services/oidc.service");
    try {
      oidcService.parseSignedState("not-a-valid-state");
      throw new Error("expected invalid_state error");
    } catch (err) {
      expect(err?.code).toBe("invalid_state");
    }
  });

  it("builds canonical frontend success redirect shape", () => {
    const oidcService = require("../src/services/oidc.service");
    const redirectUrl = oidcService.buildFrontendSuccessRedirect({
      appOrigin: "http://localhost:5173",
      appCallbackPath: "/auth/oidc/callback",
      portal: "partner",
      returnTo: "/partner/artist/orders",
      exchangeCode: "exchange-code-123",
    });

    const parsed = new URL(redirectUrl);
    expect(parsed.pathname).toBe("/auth/oidc/callback");
    expect(parsed.searchParams.get("portal")).toBe("partner");
    expect(parsed.searchParams.get("returnTo")).toBe("/partner/artist/orders");
    expect(parsed.searchParams.get("code")).toBe("exchange-code-123");
  });

  it("builds canonical frontend failure redirect shape", () => {
    const oidcService = require("../src/services/oidc.service");
    const redirectUrl = oidcService.buildFrontendFailureRedirect({
      appOrigin: "http://localhost:5173",
      portal: "fan",
      returnTo: "/fan/orders",
      errorCode: "invalid_state",
      message: "Invalid or expired OIDC state.",
    });

    const parsed = new URL(redirectUrl);
    expect(parsed.pathname).toBe("/fan/login");
    expect(parsed.searchParams.get("error")).toBe("invalid_state");
    expect(parsed.searchParams.get("message")).toBe("Invalid or expired OIDC state.");
    expect(parsed.searchParams.get("portal")).toBe("fan");
    expect(parsed.searchParams.get("returnTo")).toBe("/fan/orders");
    expect(parsed.searchParams.get("portalError")).toBeNull();
  });
});
