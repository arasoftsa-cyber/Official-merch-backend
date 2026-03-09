process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-jwt-secret";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "smoke-jwt-refresh-secret";

const request = require("supertest");
const { getDb } = require("../src/core/db/db");
const { verifyPassword } = require("../src/utils/password");
const { createAuthenticatedAgent } = require("./helpers/auth");
const {
  buildAdminFixture,
  buildBuyerFixture,
  credentialsFor,
} = require("./helpers/fixtures");
const { silenceTestLogs } = require("./helpers/logging");
const { setupMockDb } = require("./helpers/mockDb");

jest.mock("../src/core/db/db.js");
jest.mock("../src/utils/password.js");

const app = require("../app");

describe("smoke critical path", () => {
  let mockQueryBuilder;
  let restoreLogs = () => {};
  const adminUser = buildAdminFixture();
  const buyerUser = buildBuyerFixture();

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
  });

  it("app boot path responds on auth ping", async () => {
    const response = await request(app).get("/api/auth/ping");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("db connectivity smoke query resolves", async () => {
    getDb().raw.mockResolvedValue({ rows: [{ result: 1 }] });
    const result = await getDb().raw("select 1 as result");
    expect(result.rows[0].result).toBe(1);
  });

  it("admin auth and protected route succeed", async () => {
    mockQueryBuilder.first.mockResolvedValue(adminUser);

    const { agent, loginResponse } = await createAuthenticatedAgent(
      app,
      credentialsFor(adminUser)
    );
    expect(loginResponse.status).toBe(200);

    const protectedRes = await agent.get("/api/auth/whoami");
    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body.user?.role).toBe("admin");
  });

  it("public metadata route succeeds", async () => {
    const response = await request(app).get("/api/_meta/dashboards");
    expect(response.status).toBe(200);
  });

  it("admin drops list rejects unauthenticated access", async () => {
    const response = await request(app).get("/api/admin/drops");
    expect(response.status).toBe(401);
    expect(response.body?.error).toBe("unauthorized");
  });

  it("admin drops list rejects non-admin access", async () => {
    mockQueryBuilder.first.mockResolvedValue(buyerUser);
    const { agent, loginResponse } = await createAuthenticatedAgent(
      app,
      credentialsFor(buyerUser)
    );
    expect(loginResponse.status).toBe(200);

    const response = await agent.get("/api/admin/drops");
    expect(response.status).toBe(403);
    expect(response.body?.error).toBe("forbidden");
  });

  it("admin drops list returns items for admin", async () => {
    mockQueryBuilder.first.mockResolvedValue(adminUser);
    mockQueryBuilder._mockResolveValue = [];
    const { agent, loginResponse } = await createAuthenticatedAgent(
      app,
      credentialsFor(adminUser)
    );
    expect(loginResponse.status).toBe(200);

    const canonical = await agent.get("/api/admin/drops");

    expect(canonical.status).toBe(200);
    expect(Array.isArray(canonical.body?.items)).toBe(true);
  });

  it("artist access request submission sanity path succeeds", async () => {
    mockQueryBuilder.first.mockResolvedValue(null);
    mockQueryBuilder.returning.mockResolvedValue([{ id: "request-1" }]);

    const response = await request(app)
      .post("/api/artist-access-requests")
      .send({
        artistName: "Smoke Artist",
        handle: "smoke-artist",
        pitch: "Smoke pitch",
        socials: [],
        phone: "5555555555",
        requested_plan_type: "basic",
        contactEmail: "smoke-artist@example.com",
      });

    expect(response.status).toBe(201);
    expect(response.body?.request_id || response.body?.id).toBeTruthy();
  });
});
