process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-jwt-secret";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "smoke-jwt-refresh-secret";

const request = require("supertest");
const { getDb } = require("../src/core/db/db");
const { hashPassword } = require("../src/utils/password");
const { setupMockDb } = require("./helpers/mockDb");
const { sendEmailByTemplate } = require("../src/services/email.service");

jest.mock("../src/core/db/db.js");
jest.mock("../src/utils/password.js");
jest.mock("../src/services/email.service.js");
jest.mock("../src/core/db/schemaCache.js", () => ({
  hasTableCached: jest.fn().mockResolvedValue(true),
  hasColumnCached: jest.fn().mockResolvedValue(true),
}));
jest.mock("../src/services/auth.service.js", () => ({
  INVALID_REFRESH_TOKEN_CODE: "INVALID_REFRESH_TOKEN",
  issueAuthTokensForUser: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeRefreshToken: jest.fn(),
  revokeAllRefreshTokensForUser: jest.fn().mockResolvedValue(1),
}));

const app = require("../app");

describe("auth password reset flow", () => {
  let mockQueryBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ mockQueryBuilder } = setupMockDb(getDb));
    hashPassword.mockResolvedValue("new-password-hash");
    sendEmailByTemplate.mockResolvedValue({ delivered: true, skipped: false });
  });

  it("forgot password returns generic success for existing and missing emails", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "user-1",
      email: "fan@example.com",
      password_hash: "stored-hash",
    });
    mockQueryBuilder.update.mockResolvedValueOnce(1);

    const existingResponse = await request(app)
      .post("/api/auth/password/forgot")
      .send({ email: "fan@example.com" });

    expect(existingResponse.status).toBe(200);
    expect(existingResponse.body.ok).toBe(true);
    expect(existingResponse.body.message).toMatch(/if an account exists/i);
    expect(sendEmailByTemplate).toHaveBeenCalledTimes(1);
    expect(sendEmailByTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "password-reset",
        to: "fan@example.com",
      })
    );

    const updatePayload = mockQueryBuilder.update.mock.calls[0][0];
    expect(updatePayload.password_reset_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(updatePayload.password_reset_expires_at instanceof Date).toBe(true);

    mockQueryBuilder.first.mockResolvedValueOnce(null);
    const missingResponse = await request(app)
      .post("/api/auth/password/forgot")
      .send({ email: "missing@example.com" });

    expect(missingResponse.status).toBe(200);
    expect(missingResponse.body.ok).toBe(true);
    expect(missingResponse.body.message).toMatch(/if an account exists/i);
  });

  it("forgot password stays generic when email provider send fails", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "user-1",
      email: "fan@example.com",
      password_hash: "stored-hash",
    });
    mockQueryBuilder.update.mockResolvedValueOnce(1);
    sendEmailByTemplate.mockRejectedValueOnce(new Error("sendgrid-down"));

    const response = await request(app)
      .post("/api/auth/password/forgot")
      .send({ email: "fan@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.message).toMatch(/if an account exists/i);
  });

  it("reset password updates hash for valid token", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "user-1",
      email: "fan@example.com",
    });
    mockQueryBuilder.update.mockResolvedValueOnce(1);

    const response = await request(app)
      .post("/api/auth/password/reset")
      .send({
        token: "valid-reset-token",
        password: "ValidPassword123!",
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(hashPassword).toHaveBeenCalledWith("ValidPassword123!");
    expect(mockQueryBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        password_hash: "new-password-hash",
        password_reset_token_hash: null,
        password_reset_expires_at: null,
      })
    );
  });

  it("reset password rejects invalid or expired tokens", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce(null);

    const invalidResponse = await request(app)
      .post("/api/auth/password/reset")
      .send({
        token: "invalid-token",
        password: "ValidPassword123!",
      });

    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.error).toBe("invalid_or_expired_token");
  });

  it("reset password prevents one-time token reuse when update race fails", async () => {
    mockQueryBuilder.first.mockResolvedValueOnce({
      id: "user-1",
      email: "fan@example.com",
    });
    mockQueryBuilder.update.mockResolvedValueOnce(0);

    const response = await request(app)
      .post("/api/auth/password/reset")
      .send({
        token: "already-used-token",
        password: "ValidPassword123!",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_or_expired_token");
  });
});
