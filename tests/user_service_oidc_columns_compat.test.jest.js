"use strict";

jest.mock("../src/core/db/db", () => ({
  getDb: jest.fn(),
}));

const { getDb } = require("../src/core/db/db");
const userService = require("../src/services/user.service");

describe("user.service OIDC column compatibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userService.__resetUsersColumnInfoCacheForTests();
  });

  const setupDb = ({ columns }) => {
    let insertedPayload = null;
    const queryBuilder = {
      columnInfo: jest.fn().mockResolvedValue(columns),
      insert: jest.fn().mockImplementation((payload) => {
        insertedPayload = payload;
        return queryBuilder;
      }),
      returning: jest.fn().mockResolvedValue([
        {
          id: "user-id",
          email: "test@example.com",
          role: "buyer",
          password_hash: "hashed",
        },
      ]),
    };

    const db = jest.fn(() => queryBuilder);
    db.fn = { now: jest.fn(() => new Date("2026-03-09T00:00:00.000Z")) };
    getDb.mockReturnValue(db);

    return {
      getInsertedPayload: () => insertedPayload,
    };
  };

  it("does not insert OIDC columns when database does not have them", async () => {
    const { getInsertedPayload } = setupDb({
      columns: {
        id: {},
        email: {},
        password_hash: {},
        role: {},
        created_at: {},
      },
    });

    await userService.createUser({
      email: "test@example.com",
      passwordHash: "hashed",
      role: "buyer",
      authProvider: "google",
      oidcSub: "sub-123",
      avatarUrl: "https://example.com/avatar.png",
      emailVerified: true,
    });

    const payload = getInsertedPayload();
    expect(payload.auth_provider).toBeUndefined();
    expect(payload.oidc_sub).toBeUndefined();
    expect(payload.avatar_url).toBeUndefined();
    expect(payload.email_verified).toBeUndefined();
    expect(payload.email).toBe("test@example.com");
  });

  it("inserts OIDC columns when database has them", async () => {
    const { getInsertedPayload } = setupDb({
      columns: {
        id: {},
        email: {},
        password_hash: {},
        role: {},
        created_at: {},
        auth_provider: {},
        oidc_sub: {},
        avatar_url: {},
        email_verified: {},
      },
    });

    await userService.createUser({
      email: "test@example.com",
      passwordHash: "hashed",
      role: "buyer",
      authProvider: "google",
      oidcSub: "sub-123",
      avatarUrl: "https://example.com/avatar.png",
      emailVerified: true,
    });

    const payload = getInsertedPayload();
    expect(payload.auth_provider).toBe("google");
    expect(payload.oidc_sub).toBe("sub-123");
    expect(payload.avatar_url).toBe("https://example.com/avatar.png");
    expect(payload.email_verified).toBe(true);
  });
});
