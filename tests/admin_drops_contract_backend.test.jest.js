process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "drops-contract-secret";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "drops-contract-refresh-secret";

const request = require("supertest");

jest.mock("../src/core/db/db.js");
jest.mock("../src/core/db/schemaContract.js", () => {
  const actual = jest.requireActual("../src/core/db/schemaContract.js");
  return {
    ...actual,
    assertAdminArtistDirectorySchema: jest.fn(async () => true),
  };
});

const { getDb } = require("../src/core/db/db");
const { signAccessToken } = require("../src/utils/jwt");
const app = require("../app");

const authHeaderForAdmin = () => ({
  Authorization: `Bearer ${signAccessToken({
    sub: "admin-user",
    email: "admin@example.com",
    role: "admin",
  })}`,
});

const createStaticQuery = (rows) => {
  const query = {
    select: jest.fn(() => query),
    leftJoin: jest.fn(() => query),
    whereIn: jest.fn(() => query),
    where: jest.fn(() => query),
    orderBy: jest.fn(() => query),
    limit: jest.fn(() => query),
    first: jest.fn(async () => rows[0] || null),
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
  return query;
};

const createAdminArtistDb = ({
  artists = [],
  linkedUsers = [],
  requests = [],
} = {}) => {
  const db = jest.fn((tableName) => {
    const table = String(tableName || "").trim().toLowerCase();
    if (table.startsWith("artists")) return createStaticQuery(artists);
    if (table.startsWith("artist_user_map")) return createStaticQuery(linkedUsers);
    if (table.startsWith("artist_access_requests")) return createStaticQuery(requests);
    return createStaticQuery([]);
  });

  db.fn = { now: () => "2026-03-16T00:00:00.000Z" };
  db.raw = jest.fn((sql, bindings) => ({ sql, bindings }));
  db.schema = { hasTable: jest.fn(async () => true) };
  db.transaction = jest.fn(async (callback) => callback(db));

  return db;
};

describe("admin drops backend contracts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /api/admin/artists returns an items envelope", async () => {
    getDb.mockReturnValue(
      createAdminArtistDb({
        artists: [
          {
            id: "artist-1",
            name: "Artist One",
            handle: "artist-one",
            created_at: "2026-03-16T00:00:00.000Z",
            status: "active",
            email: "artist@example.com",
            phone: "1234567890",
            is_featured: true,
          },
        ],
      })
    );

    const response = await request(app)
      .get("/api/admin/artists")
      .set(authHeaderForAdmin());

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body?.items)).toBe(true);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      id: "artist-1",
      name: "Artist One",
      handle: "artist-one",
    });
  });

  it("GET /api/admin/artists returns items: [] when empty", async () => {
    getDb.mockReturnValue(createAdminArtistDb());

    const response = await request(app)
      .get("/api/admin/artists")
      .set(authHeaderForAdmin());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      total: 0,
    });
  });

  it("GET /api/config returns runtime config", async () => {
    const response = await request(app).get("/api/config");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      environment: expect.any(String),
      apiBaseUrl: expect.anything(),
      currency: expect.any(String),
      locale: expect.any(String),
      timeZone: expect.any(String),
      features: expect.any(Object),
    });
  });
});
