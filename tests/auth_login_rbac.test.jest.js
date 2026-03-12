process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-jwt-secret";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "smoke-jwt-refresh-secret";

const request = require("supertest");
const { getDb } = require("../src/core/db/db");
const { verifyPassword, hashPassword } = require("../src/utils/password");
const { createUser } = require("../src/services/user.service");
const { sendEmailByTemplate } = require("../src/services/email.service");
const { createAuthenticatedAgent } = require("./helpers/auth");
const {
  buildAdminFixture,
  buildBuyerFixture,
  buildLabelFixture,
  buildRequesterFixture,
  credentialsFor,
} = require("./helpers/fixtures");
const { silenceTestLogs } = require("./helpers/logging");
const { setupMockDb } = require("./helpers/mockDb");
const { unwrapArrayBody } = require("./helpers/response");

jest.mock("../src/core/db/db.js");
jest.mock("../src/utils/password.js");
jest.mock("../src/services/user.service");
jest.mock("../src/services/email.service.js");

const app = require("../app");

describe("auth login and RBAC", () => {
  let mockQueryBuilder;
  let restoreLogs = () => {};

  const adminUser = buildAdminFixture();
  const buyerUser = buildBuyerFixture();
  const labelUser = buildLabelFixture();
  const artistUser = {
    id: "artist-id",
    email: "artist@example.com",
    role: "artist",
    password_hash: "hash",
  };
  const requesterUser = buildRequesterFixture();

  beforeAll(() => {
    restoreLogs = silenceTestLogs(["log", "warn"]);
  });

  afterAll(() => {
    restoreLogs();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ({ mockQueryBuilder } = setupMockDb(getDb));
    verifyPassword.mockResolvedValue(true);
    hashPassword.mockResolvedValue("hashed-password");
    sendEmailByTemplate.mockResolvedValue({ delivered: true, skipped: false });
    createUser.mockResolvedValue({
      id: requesterUser.id,
      email: requesterUser.email,
      role: "buyer",
    });
  });

  it("admin login succeeds for standard and partner portals", async () => {
    mockQueryBuilder.first.mockResolvedValue(adminUser);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send(credentialsFor(adminUser));
    expect(loginRes.status).toBe(200);

    mockQueryBuilder.first.mockClear();
    mockQueryBuilder.first.mockResolvedValue(adminUser);

    const partnerLoginRes = await request(app)
      .post("/api/auth/partner/login")
      .send(credentialsFor(adminUser));
    expect(partnerLoginRes.status).toBe(200);
  });

  it("buyer login succeeds but partner login is rejected", async () => {
    mockQueryBuilder.first.mockResolvedValue(buyerUser);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send(credentialsFor(buyerUser));
    expect(loginRes.status).toBe(200);

    mockQueryBuilder.first.mockClear();
    mockQueryBuilder.first.mockResolvedValue(buyerUser);

    const partnerLoginRes = await request(app)
      .post("/api/auth/partner/login")
      .send(credentialsFor(buyerUser));
    expect(partnerLoginRes.status).toBe(403);
    expect(partnerLoginRes.body).toEqual({
      error: "auth_portal_mismatch_partner_to_fan",
      message: "This account belongs to the Fan Portal. Use fan login.",
    });
  });

  it("label login succeeds for general portal", async () => {
    mockQueryBuilder.first.mockResolvedValue(labelUser);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send(credentialsFor(labelUser));
    expect(loginRes.status).toBe(200);
  });

  it("label partner login succeeds when label mapping exists", async () => {
    mockQueryBuilder.first
      .mockResolvedValueOnce(labelUser)
      .mockResolvedValueOnce({ user_id: labelUser.id });

    const partnerLoginRes = await request(app)
      .post("/api/auth/partner/login")
      .send(credentialsFor(labelUser));

    expect(partnerLoginRes.status).toBe(200);
  });

  it("label partner login rejects when label mapping is missing", async () => {
    mockQueryBuilder.first
      .mockResolvedValueOnce(labelUser)
      .mockResolvedValueOnce(null);

    const partnerLoginRes = await request(app)
      .post("/api/auth/partner/login")
      .send(credentialsFor(labelUser));

    expect(partnerLoginRes.status).toBe(403);
    expect(partnerLoginRes.body.error).toBe("auth_partner_account_unapproved");
    expect(partnerLoginRes.body.message).toBe("Partner account is not approved yet.");
  });

  it("fan login rejects partner/admin account with portal-mismatch contract", async () => {
    mockQueryBuilder.first.mockResolvedValue(adminUser);

    const fanLoginRes = await request(app)
      .post("/api/auth/fan/login")
      .send(credentialsFor(adminUser));

    expect(fanLoginRes.status).toBe(403);
    expect(fanLoginRes.body).toEqual({
      error: "auth_portal_mismatch_fan_to_partner",
      message: "This account belongs to the Partner Portal. Use partner login.",
    });
  });

  it("partner invalid credentials remains unauthorized and distinct from forbidden portal mismatch", async () => {
    mockQueryBuilder.first.mockResolvedValue(null);

    const partnerLoginRes = await request(app)
      .post("/api/auth/partner/login")
      .send(credentialsFor(buyerUser));

    expect(partnerLoginRes.status).toBe(401);
    expect(partnerLoginRes.body.error).toBe("invalid_credentials");
    expect(partnerLoginRes.body.message).toBe("Invalid email or password");
  });

  it("artist login succeeds for standard and partner portals when artist mapping exists", async () => {
    mockQueryBuilder.first.mockResolvedValue(artistUser);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send(credentialsFor(artistUser));
    expect(loginRes.status).toBe(200);

    mockQueryBuilder.first.mockClear();
    mockQueryBuilder.first
      .mockResolvedValueOnce(artistUser)
      .mockResolvedValueOnce({ user_id: artistUser.id });

    const partnerLoginRes = await request(app)
      .post("/api/auth/partner/login")
      .send(credentialsFor(artistUser));
    expect(partnerLoginRes.status).toBe(200);
  });

  it("authenticated admin can access protected auth and leads routes", async () => {
    mockQueryBuilder.first.mockResolvedValue(adminUser);
    mockQueryBuilder._mockResolveValue = [{ id: "lead-1" }];

    const { agent, loginResponse } = await createAuthenticatedAgent(
      app,
      credentialsFor(adminUser)
    );
    expect(loginResponse.status).toBe(200);

    const whoamiRes = await agent.get("/api/auth/whoami");
    expect(whoamiRes.status).toBe(200);
    expect(whoamiRes.body.user?.role).toBe("admin");

    const probeRes = await agent.get("/api/auth/probe");
    expect(probeRes.status).toBe(200);

    const leadsRes = await agent.get("/api/admin/leads");
    expect(leadsRes.status).toBe(200);
    expect(Array.isArray(unwrapArrayBody(leadsRes))).toBe(true);
  });

  it("buyer probe access is forbidden", async () => {
    mockQueryBuilder.first.mockResolvedValue(buyerUser);

    const { agent, loginResponse } = await createAuthenticatedAgent(
      app,
      credentialsFor(buyerUser)
    );
    expect(loginResponse.status).toBe(200);

    const probeRes = await agent.get("/api/auth/probe");
    expect(probeRes.status).toBe(403);
  });

  it("label can read but cannot mutate label-protected route", async () => {
    mockQueryBuilder.first.mockResolvedValue(labelUser);

    const { agent, loginResponse } = await createAuthenticatedAgent(
      app,
      credentialsFor(labelUser)
    );
    expect(loginResponse.status).toBe(200);

    const readRes = await agent.get("/api/auth/label-read");
    expect(readRes.status).toBe(200);

    const mutateRes = await agent.get("/api/auth/label-mutate");
    expect(mutateRes.status).toBe(403);
  });

  it("buyer and artist cannot create products", async () => {
    mockQueryBuilder.first.mockResolvedValue(buyerUser);
    const buyerSession = await createAuthenticatedAgent(app, credentialsFor(buyerUser));
    expect(buyerSession.loginResponse.status).toBe(200);

    const buyerCreateRes = await buyerSession.agent.post("/api/products").send({
      title: "Forbidden Buyer Product",
    });
    expect(buyerCreateRes.status).toBe(403);

    mockQueryBuilder.first.mockClear();
    mockQueryBuilder.first.mockResolvedValue(artistUser);
    const artistSession = await createAuthenticatedAgent(app, credentialsFor(artistUser));
    expect(artistSession.loginResponse.status).toBe(200);

    const artistCreateRes = await artistSession.agent.post("/api/products").send({
      title: "Forbidden Artist Product",
    });
    expect(artistCreateRes.status).toBe(403);
  });

  it("requester registration succeeds and returns auth token payload", async () => {
    mockQueryBuilder.first.mockResolvedValue(null);
    const email = `requester-${Date.now()}@example.com`;
    createUser.mockResolvedValueOnce({
      id: requesterUser.id,
      email,
      role: "buyer",
    });

    const registerRes = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: "ValidPassword123!",
      });

    expect(registerRes.status).toBe(200);
    expect(registerRes.body.accessToken).toBeTruthy();
    expect(registerRes.body.refreshToken).toBeTruthy();
    expect(registerRes.body.user?.email).toBe(email);
    expect(registerRes.body.user?.role).toBe("buyer");
    expect(sendEmailByTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "welcome-account",
        to: email,
      })
    );
  });
});
