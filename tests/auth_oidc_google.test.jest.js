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
    expect(response.headers.location).toContain("portalError=partner_account");
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
    expect(response.headers.location).toContain("portalError=partner_unknown_account");
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
    expect(response.headers.location).toContain("portalError=partner_not_approved");
  });

  it("OIDC exchange rejects missing code and invalid codes", async () => {
    const missingCode = await request(app)
      .post("/api/auth/oidc/google/exchange")
      .send({});
    expect(missingCode.status).toBe(400);

    oidcService.consumeExchangeCode.mockReturnValueOnce(null);
    const invalidCode = await request(app)
      .post("/api/auth/oidc/google/exchange")
      .send({ code: "invalid-code" });
    expect(invalidCode.status).toBe(401);
    expect(invalidCode.body.error).toBe("invalid_exchange_code");
  });
});
