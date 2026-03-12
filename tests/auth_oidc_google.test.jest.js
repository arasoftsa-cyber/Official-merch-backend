process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-jwt-secret";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "smoke-jwt-refresh-secret";

const request = require("supertest");
const { getDb } = require("../src/core/db/db");
const { hashPassword } = require("../src/utils/password");
const authService = require("../src/services/auth.service");
const userService = require("../src/services/user.service");
const oidcService = require("../src/services/oidc.service");
const { setupMockDb } = require("./helpers/mockDb");

jest.mock("../src/core/db/db.js");
jest.mock("../src/utils/password.js");
jest.mock("../src/services/user.service.js");
jest.mock("../src/services/oidc.service.js");

const app = require("../app");

describe("OIDC Google auth flow", () => {
  let mockQueryBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ mockQueryBuilder } = setupMockDb(getDb));
    authService.issueAuthTokensForUser = jest.fn().mockResolvedValue({
      accessToken: "oidc-access-token",
      refreshToken: "oidc-refresh-token",
    });
    oidcService.prepareGoogleOidcStart.mockResolvedValue({
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?mock=1",
    });
    oidcService.buildFrontendSuccessRedirect.mockImplementation(
      ({ appOrigin, appCallbackPath, portal, returnTo, exchangeCode }) =>
        `${appOrigin}${appCallbackPath}?portal=${encodeURIComponent(
          portal
        )}&returnTo=${encodeURIComponent(returnTo)}&code=${encodeURIComponent(exchangeCode)}`
    );
    oidcService.buildFrontendFailureRedirect.mockImplementation(
      ({ appOrigin, portal, returnTo, errorCode, message }) =>
        `${appOrigin}/${portal}/login?error=${encodeURIComponent(
          errorCode
        )}&message=${encodeURIComponent(message)}&portal=${encodeURIComponent(
          portal
        )}&returnTo=${encodeURIComponent(returnTo)}`
    );
    oidcService.consumeExchangeCodeDetailed.mockImplementation(() => ({
      ok: false,
      reason: "invalid_or_expired",
    }));
    oidcService.issueExchangeCode.mockReturnValue("exchange-code-123");
    oidcService.toSafeReturnTo.mockImplementation((value, portal) => {
      if (value && String(value).startsWith("/")) return value;
      return portal === "partner" ? "/partner/dashboard" : "/fan";
    });
  });

  const mockCallbackPayload = (overrides = {}) => {
    oidcService.consumeGoogleCallback.mockResolvedValue({
      portal: "fan",
      returnTo: "/fan",
      appOrigin: "http://localhost:5173",
      email: "fan@example.com",
      sub: "google-sub-1",
      avatarUrl: "https://example.com/avatar.png",
      emailVerified: true,
      ...overrides,
    });
  };

  it("fan OIDC login creates a new fan account when email is unknown", async () => {
    mockCallbackPayload();
    mockQueryBuilder.first.mockResolvedValueOnce(null);
    hashPassword.mockResolvedValueOnce("generated-password-hash");
    userService.createUser.mockResolvedValueOnce({
      id: "new-fan-id",
      email: "fan@example.com",
      role: "buyer",
    });

    const response = await request(app).get("/api/auth/oidc/google/callback");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/auth/oidc/callback");
    expect(response.headers.location).toContain("code=exchange-code-123");
    expect(userService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "fan@example.com",
        role: "buyer",
        authProvider: "google",
        oidcSub: "google-sub-1",
      })
    );
    expect(authService.issueAuthTokensForUser).toHaveBeenCalled();
  });

  it("OIDC start accepts valid canonical parameters and redirects to Google", async () => {
    const response = await request(app).get(
      "/api/auth/oidc/google/start?portal=fan&returnTo=%2Ffan%2Forders&appOrigin=http%3A%2F%2Flocalhost%3A5173"
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("accounts.google.com");
    expect(oidcService.prepareGoogleOidcStart).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          portal: "fan",
          returnTo: "/fan/orders",
          appOrigin: "http://localhost:5173",
        }),
      })
    );
  });

  it("fan OIDC login reuses an existing fan account", async () => {
    mockCallbackPayload();
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "buyer-id",
      email: "fan@example.com",
      role: "buyer",
      auth_provider: null,
      oidc_sub: null,
    });
    userService.updateUserAuthProviderById.mockResolvedValueOnce({
      id: "buyer-id",
      email: "fan@example.com",
      role: "buyer",
      auth_provider: "google",
      oidc_sub: "google-sub-1",
    });

    const response = await request(app).get("/api/auth/oidc/google/callback");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/auth/oidc/callback");
    expect(userService.createUser).not.toHaveBeenCalled();
    expect(userService.updateUserAuthProviderById).toHaveBeenCalledWith(
      "buyer-id",
      expect.objectContaining({
        authProvider: "google",
        oidcSub: "google-sub-1",
      })
    );
  });

  it("fan OIDC login rejects partner/admin emails in fan portal", async () => {
    mockCallbackPayload({ email: "admin@example.com", portal: "fan", returnTo: "/fan/orders" });
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "admin-id",
      email: "admin@example.com",
      role: "admin",
    });

    const response = await request(app).get("/api/auth/oidc/google/callback");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/fan/login");
    expect(response.headers.location).toContain(
      "error=auth_portal_mismatch_fan_to_partner"
    );
    expect(response.headers.location).not.toContain("portalError=");
    expect(oidcService.issueExchangeCode).not.toHaveBeenCalled();
  });

  it("partner OIDC login works for approved existing partner/admin account", async () => {
    mockCallbackPayload({
      portal: "partner",
      returnTo: "/partner/artist",
      email: "artist@example.com",
    });
    mockQueryBuilder.first
      .mockResolvedValueOnce({
        id: "artist-id",
        email: "artist@example.com",
        role: "artist",
        auth_provider: null,
        oidc_sub: null,
      })
      .mockResolvedValueOnce({ user_id: "artist-id" });
    userService.updateUserAuthProviderById.mockResolvedValueOnce({
      id: "artist-id",
      email: "artist@example.com",
      role: "artist",
      auth_provider: "google",
      oidc_sub: "google-sub-1",
    });

    const response = await request(app).get("/api/auth/oidc/google/callback");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/auth/oidc/callback");
    expect(response.headers.location).toContain("portal=partner");
    expect(response.headers.location).toContain("code=exchange-code-123");
  });

  it("partner OIDC login rejects unknown partner account", async () => {
    mockCallbackPayload({
      portal: "partner",
      returnTo: "/partner/dashboard",
      email: "unknown@example.com",
    });
    mockQueryBuilder.first.mockResolvedValueOnce(null);

    const response = await request(app).get("/api/auth/oidc/google/callback");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/partner/login");
    expect(response.headers.location).toContain("error=auth_partner_account_not_found");
    expect(response.headers.location).not.toContain("portalError=");
  });

  it("partner OIDC login rejects unapproved partner account", async () => {
    mockCallbackPayload({
      portal: "partner",
      returnTo: "/partner/dashboard",
      email: "artist@example.com",
    });
    mockQueryBuilder.first
      .mockResolvedValueOnce({
        id: "artist-id",
        email: "artist@example.com",
        role: "artist",
      })
      .mockResolvedValueOnce(null);

    const response = await request(app).get("/api/auth/oidc/google/callback");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/partner/login");
    expect(response.headers.location).toContain("error=auth_partner_account_unapproved");
    expect(response.headers.location).not.toContain("portalError=");
  });

  it("OIDC exchange rejects missing code and invalid codes", async () => {
    const missingCode = await request(app)
      .post("/api/auth/oidc/google/exchange")
      .send({});
    expect(missingCode.status).toBe(400);
    expect(missingCode.body.error).toBe("oidc_exchange_failed");

    oidcService.consumeExchangeCodeDetailed.mockReturnValueOnce({
      ok: false,
      reason: "invalid_or_expired",
    });
    const invalidCode = await request(app)
      .post("/api/auth/oidc/google/exchange")
      .send({ code: "invalid-code" });
    expect(invalidCode.status).toBe(401);
    expect(invalidCode.body.error).toBe("oidc_exchange_failed");
  });

  it("OIDC exchange returns duplicate callback code contract", async () => {
    oidcService.consumeExchangeCodeDetailed.mockReturnValueOnce({
      ok: false,
      reason: "duplicate",
    });

    const duplicateCode = await request(app)
      .post("/api/auth/oidc/google/exchange")
      .send({ code: "used-code" });

    expect(duplicateCode.status).toBe(409);
    expect(duplicateCode.body.error).toBe("oidc_callback_replay_or_duplicate");
    expect(duplicateCode.body.message).toMatch(/already been consumed/i);
  });

  it("OIDC start returns explicit contract failures for invalid inputs", async () => {
    oidcService.prepareGoogleOidcStart.mockRejectedValueOnce({
      code: "invalid_portal",
      message: "portal must be fan or partner.",
    });
    const invalidPortal = await request(app).get("/api/auth/oidc/google/start?portal=bad");
    expect(invalidPortal.status).toBe(400);
    expect(invalidPortal.body.error).toBe("invalid_portal");

    oidcService.prepareGoogleOidcStart.mockRejectedValueOnce({
      code: "invalid_origin",
      message: "OIDC appOrigin must be an allowed frontend origin.",
    });
    const invalidOrigin = await request(app).get(
      "/api/auth/oidc/google/start?portal=fan&appOrigin=https://evil.example"
    );
    expect(invalidOrigin.status).toBe(400);
    expect(invalidOrigin.body.error).toBe("invalid_origin");

    oidcService.prepareGoogleOidcStart.mockRejectedValueOnce({
      code: "invalid_return_to",
      message: "returnTo must be a safe internal path starting with '/'.",
    });
    const invalidReturnTo = await request(app).get(
      "/api/auth/oidc/google/start?portal=fan&returnTo=https://evil.example"
    );
    expect(invalidReturnTo.status).toBe(400);
    expect(invalidReturnTo.body.error).toBe("invalid_return_to");
  });

  it("OIDC callback invalid state maps to stable failure redirect shape", async () => {
    oidcService.consumeGoogleCallback.mockRejectedValueOnce({
      code: "invalid_state",
      message: "Invalid or expired OIDC state.",
    });
    oidcService.parseSignedState.mockImplementationOnce(() => {
      throw new Error("bad state");
    });
    oidcService.buildFrontendFailureRedirect.mockReturnValueOnce(
      "http://localhost:5173/fan/login?error=invalid_state&message=Invalid%20or%20expired%20OIDC%20state.&portal=fan&returnTo=%2Ffan"
    );

    const response = await request(app).get("/api/auth/oidc/google/callback?state=invalid");
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("error=invalid_state");
    expect(response.headers.location).toContain("portal=fan");
  });
});
