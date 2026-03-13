process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-jwt-secret";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "smoke-jwt-refresh-secret";

const request = require("supertest");
const { getDb } = require("../src/core/db/db");
const { hasTableCached } = require("../src/core/db/schemaCache");
const { verifyRefreshToken, signAccessToken, signRefreshToken } = require("../src/utils/jwt");
const { setupMockDb } = require("./helpers/mockDb");

jest.mock("../src/core/db/db.js");
jest.mock("../src/core/db/schemaCache.js", () => ({
  hasTableCached: jest.fn().mockResolvedValue(true),
}));
jest.mock("../src/utils/jwt.js", () => ({
  verifyRefreshToken: jest.fn(),
  signAccessToken: jest.fn(),
  signRefreshToken: jest.fn(),
}));

const app = require("../app");

describe("auth refresh lifecycle", () => {
  let mockQueryBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ mockQueryBuilder } = setupMockDb(getDb));
    hasTableCached.mockResolvedValue(true);
    signAccessToken.mockReturnValue("next-access-token");
    signRefreshToken.mockReturnValue("next-refresh-token");
    mockQueryBuilder.update.mockResolvedValue(1);
  });

  it("valid refresh succeeds and returns rotated auth payload", async () => {
    verifyRefreshToken.mockReturnValue({ sub: "user-1" });
    mockQueryBuilder.first
      .mockResolvedValueOnce({
        user_id: "user-1",
        token_hash: "hash",
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce({
        id: "user-1",
        email: "buyer@example.com",
        role: "buyer",
      });

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "refresh-token-1" });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      "accessToken",
      "refreshToken",
      "user",
    ]);
    expect(response.body.accessToken).toBe("next-access-token");
    expect(response.body.refreshToken).toBe("next-refresh-token");
    expect(Object.keys(response.body.user).sort()).toEqual(["email", "id", "role"]);
    expect(response.body.user).toEqual({
      id: "user-1",
      email: "buyer@example.com",
      role: "buyer",
    });
    expect(mockQueryBuilder.insert).toHaveBeenCalled();
  });

  it("missing refresh token fails with consistent error payload", async () => {
    const response = await request(app).post("/api/auth/refresh").send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("missing_refresh_token");
    expect(response.body.message).toBe("missing_refresh_token");
  });

  it("invalid refresh token fails cleanly", async () => {
    verifyRefreshToken.mockImplementation(() => {
      throw new Error("invalid-signature");
    });

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "bad-token" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("invalid_refresh_token");
  });

  it("expired refresh token fails cleanly", async () => {
    verifyRefreshToken.mockImplementation(() => {
      const err = new Error("jwt expired");
      err.name = "TokenExpiredError";
      throw err;
    });

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "expired-token" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("expired_refresh_token");
  });

  it("revoked/reused refresh token fails and triggers session invalidation", async () => {
    verifyRefreshToken.mockReturnValue({ sub: "user-1" });
    mockQueryBuilder.first.mockResolvedValueOnce({
      user_id: "user-1",
      token_hash: "hash",
      revoked_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
    });

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "already-rotated-token" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("revoked_refresh_token");
    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
      })
    );
  });

  it("enforces rotation consistently when old token is reused", async () => {
    verifyRefreshToken.mockReturnValue({ sub: "user-1" });
    mockQueryBuilder.first
      .mockResolvedValueOnce({
        user_id: "user-1",
        token_hash: "hash",
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce({
        id: "user-1",
        email: "buyer@example.com",
        role: "buyer",
      })
      .mockResolvedValueOnce({
        user_id: "user-1",
        token_hash: "hash",
        revoked_at: new Date(),
        expires_at: new Date(Date.now() + 60_000),
      });

    const firstResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "single-use-refresh-token" });
    const secondResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "single-use-refresh-token" });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(401);
    expect(secondResponse.body.error).toBe("revoked_refresh_token");
  });

  it("fails cleanly when refresh session user is no longer valid", async () => {
    verifyRefreshToken.mockReturnValue({ sub: "user-1" });
    mockQueryBuilder.first
      .mockResolvedValueOnce({
        user_id: "user-1",
        token_hash: "hash",
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce(null);
    mockQueryBuilder.update.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "orphaned-session-token" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("invalid_refresh_session");
  });
});
