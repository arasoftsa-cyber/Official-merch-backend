process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-jwt-secret";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "smoke-jwt-refresh-secret";

const request = require("supertest");
const { getDb } = require("../src/core/db/db");
const { verifyPassword } = require("../src/utils/password");
const { can } = require("../src/core/rbac");
const { signAccessToken } = require("../src/utils/jwt");
const { createAuthenticatedAgent } = require("./helpers/auth");
const { assertAliasParity } = require("./helpers/routes");
const { buildAdminFixture, credentialsFor } = require("./helpers/fixtures");
const { silenceTestLogs } = require("./helpers/logging");
const { setupMockDb } = require("./helpers/mockDb");

jest.mock("../src/core/db/db.js");
jest.mock("../src/utils/password.js");
jest.mock("../src/utils/ownership.js", () => ({
  isLabelLinkedToArtist: jest.fn(async () => true),
  isUserLinkedToArtist: jest.fn(async () => true),
  doesUserOwnLabel: jest.fn(async () => true),
}));
jest.mock("../src/services/dashboard.service.js", () => ({
  getArtistDashboardSummary: jest.fn(),
  getArtistDashboardOrders: jest.fn(),
  getArtistDashboardOrderDetail: jest.fn(),
}));
jest.mock("../src/services/labels-dashboard.service.js", () => ({
  getLabelDashboardSummary: jest.fn(),
  getLabelDashboardOrders: jest.fn(),
  getLabelArtistSummary: jest.fn(),
  resolveLabelIdForUser: jest.fn(),
  createEmptyDashboardPayload: jest.fn(() => ({
    totalArtists: 0,
    activeArtists30d: 0,
    inactiveArtists: 0,
    grossCents: 0,
    artists: [],
  })),
  clampOrderLimit: jest.fn(() => 10),
}));

const app = require("../app");
const dashboardService = require("../src/services/dashboard.service.js");
const labelsDashboardService = require("../src/services/labels-dashboard.service.js");
const ownership = require("../src/utils/ownership.js");

describe("auth dashboard metadata and aliases", () => {
  let mockQueryBuilder;
  let restoreLogs = () => {};
  const adminUser = buildAdminFixture();

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

  it("/api/_meta/dashboards returns canonical role dashboard map", async () => {
    const response = await request(app).get("/api/_meta/dashboards");

    expect(response.status).toBe(200);
    const body = response.body || {};
    const expectedKeys = ["artist", "label", "admin", "buyer"];
    for (const key of expectedKeys) {
      expect(Array.isArray(body[key])).toBe(true);
      for (const entry of body[key]) {
        expect(typeof entry).toBe("string");
      }
    }
  });

  it("admin leads alias parity holds between canonical and partner alias routes", async () => {
    mockQueryBuilder.first.mockResolvedValue(adminUser);
    mockQueryBuilder._mockResolveValue = [
      {
        id: "lead-1",
        email: "lead@example.com",
        status: "new",
        created_at: "2026-03-08T00:00:00.000Z",
      },
    ];

    const { agent, loginResponse } = await createAuthenticatedAgent(
      app,
      credentialsFor(adminUser)
    );
    expect(loginResponse.status).toBe(200);

    const { canonicalResponse, aliasResponse, canonicalBody, aliasBody } =
      await assertAliasParity({
      agent,
      canonicalPath: "/api/admin/leads",
      aliasPath: "/api/partner/admin/leads",
      expectedStatus: 200,
      unwrapKeys: ["items", "leads"],
    });

    expect(Array.isArray(canonicalResponse.body)).toBe(true);
    expect(Array.isArray(aliasResponse.body)).toBe(true);
    expect(Array.isArray(canonicalBody)).toBe(true);
    expect(Array.isArray(aliasBody)).toBe(true);
    expect(aliasBody).toEqual(canonicalBody);
    if (canonicalBody.length > 0 || aliasBody.length > 0) {
      const canonicalFirst = canonicalBody[0] || {};
      const aliasFirst = aliasBody[0] || {};
      expect(Boolean(canonicalFirst.id)).toBe(true);
      expect(Boolean(aliasFirst.id)).toBe(true);
      expect(Boolean(canonicalFirst.status)).toBe(true);
      expect(Boolean(aliasFirst.status)).toBe(true);
      const canonicalCreatedAt = canonicalFirst.created_at || canonicalFirst.createdAt;
      const aliasCreatedAt = aliasFirst.created_at || aliasFirst.createdAt;
      expect(Boolean(canonicalCreatedAt)).toBe(true);
      expect(Boolean(aliasCreatedAt)).toBe(true);
    }
  });

  it("role matrix grants and denies expected baseline policies", async () => {
    await expect(
      Promise.resolve(can({ role: "admin", id: "u1" }, "admin:probe", "system"))
    ).resolves.toBe(true);
    await expect(
      Promise.resolve(can({ role: "buyer", id: "u2" }, "admin:probe", "system"))
    ).resolves.toBe(false);
    await expect(
      Promise.resolve(can({ role: "label", id: "u3" }, "label:artist:read", "system"))
    ).resolves.toBe(true);
    await expect(
      Promise.resolve(can({ role: "label", id: "u3" }, "label:artist:write", "system"))
    ).resolves.toBe(false);
  });
});

const authHeaderFor = (role, id = `${role}-user`) => ({
  Authorization: `Bearer ${signAccessToken({
    sub: id,
    email: `${role}@example.com`,
    role,
  })}`,
});

const createDashboardDb = () => {
  const artistUserMap = [{ user_id: "artist-user", artist_id: "artist-1" }];
  const labelArtistMap = [{ label_id: "label-1", artist_id: "artist-1" }];

  const makeQuery = (tableName) => {
    const table = String(tableName || "").split(/\s+as\s+/i)[0].trim();
    const ctx = {
      whereObj: {},
      whereRules: [],
      groupBy: [],
      countSpec: null,
      countDistinctSpec: null,
      sumSpec: null,
    };

    const applyWhere = (rows) =>
      rows.filter((row) => {
        const matchesObject = Object.entries(ctx.whereObj).every(
          ([key, value]) => row[String(key).split(".").pop()] === value
        );
        if (!matchesObject) return false;
        return ctx.whereRules.every((rule) => {
          const column = String(rule.column || "").split(".").pop();
          if (rule.op === "=") return row[column] === rule.value;
          return true;
        });
      });

    const execute = () => {
      if (table === "orders") {
        if (ctx.countSpec && ctx.groupBy.includes("status")) {
          return [
            { status: "placed", count: 1 },
            { status: "fulfilled", count: 1 },
          ];
        }
        if (ctx.countSpec) {
          return [{ total: 2 }];
        }
        if (ctx.sumSpec) {
          return [{ gmvCents: 4200 }];
        }
        if (ctx.countDistinctSpec) {
          return [{ buyersTotal: 1 }];
        }
        if (ctx.groupBy.includes("day")) {
          return [{ day: "2026-03-08", fulfilledCount: 1, gmvCents: 4200 }];
        }
        return [];
      }

      if (table === "artist_user_map") {
        return applyWhere(artistUserMap);
      }
      if (table === "label_artist_map") {
        return applyWhere(labelArtistMap);
      }
      return [];
    };

    const query = {
      where(arg1, arg2, arg3) {
        if (arg1 && typeof arg1 === "object" && arg2 === undefined) {
          ctx.whereObj = { ...ctx.whereObj, ...arg1 };
          return query;
        }
        if (arg3 === undefined) {
          ctx.whereRules.push({ column: arg1, op: "=", value: arg2 });
        } else {
          ctx.whereRules.push({ column: arg1, op: String(arg2 || "="), value: arg3 });
        }
        return query;
      },
      andWhere(arg1, arg2, arg3) {
        return query.where(arg1, arg2, arg3);
      },
      leftJoin() {
        return query;
      },
      select() {
        return query;
      },
      groupBy(...cols) {
        ctx.groupBy.push(...cols.map((col) => String(col).split(".").pop()));
        return query;
      },
      count(spec) {
        ctx.countSpec = spec;
        return query;
      },
      sum(spec) {
        ctx.sumSpec = spec;
        return query;
      },
      countDistinct(spec) {
        ctx.countDistinctSpec = spec;
        return query;
      },
      orderBy() {
        return query;
      },
      limit() {
        return query;
      },
      async first() {
        return execute()[0] || null;
      },
      async pluck(column) {
        const key = String(column || "").split(".").pop();
        return execute().map((row) => row[key]);
      },
      then(resolve, reject) {
        try {
          resolve(execute());
        } catch (error) {
          if (reject) reject(error);
          else throw error;
        }
      },
    };
    return query;
  };

  const db = (tableName) => makeQuery(tableName);
  db.raw = () => "__raw__";
  db.schema = {
    hasTable: async () => true,
  };
  db.fn = { now: () => "2026-03-08T00:00:00.000Z" };
  return db;
};

describe("dashboard runtime contracts and role-forbidden access", () => {
  let restoreRuntimeLogs = () => {};

  beforeAll(() => {
    restoreRuntimeLogs = silenceTestLogs(["log", "warn"]);
  });

  afterAll(() => {
    restoreRuntimeLogs();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ownership.isLabelLinkedToArtist.mockResolvedValue(true);
    labelsDashboardService.resolveLabelIdForUser.mockResolvedValue("label-1");
  });

  it("admin dashboard summary returns payload contract and forbids non-admin roles", async () => {
    getDb.mockReturnValue(createDashboardDb());

    const adminRes = await request(app)
      .get("/api/admin/dashboard/summary")
      .set(authHeaderFor("admin", "admin-user"));
    expect(adminRes.status).toBe(200);
    expect(typeof adminRes.body?.orders?.total).toBe("number");
    expect(typeof adminRes.body?.orders?.placed).toBe("number");
    expect(typeof adminRes.body?.orders?.cancelled).toBe("number");
    expect(typeof adminRes.body?.orders?.fulfilled).toBe("number");
    expect(typeof adminRes.body?.gmvCents).toBe("number");
    expect(typeof adminRes.body?.buyers?.total).toBe("number");
    expect(Array.isArray(adminRes.body?.last7Days)).toBe(true);

    const adminMetricsRes = await request(app)
      .get("/api/admin/metrics")
      .set(authHeaderFor("admin", "admin-user"));
    expect(adminMetricsRes.status).toBe(200);
    expect(typeof adminMetricsRes.body?.orders?.total).toBe("number");
    expect(Array.isArray(adminMetricsRes.body?.last7Days)).toBe(true);

    const adminOrdersRes = await request(app)
      .get("/api/admin/dashboard/orders")
      .set(authHeaderFor("admin", "admin-user"));
    expect(adminOrdersRes.status).toBe(200);
    expect(Array.isArray(adminOrdersRes.body?.items)).toBe(true);

    for (const role of ["buyer", "artist", "label"]) {
      const forbiddenRes = await request(app)
        .get("/api/admin/dashboard/summary")
        .set(authHeaderFor(role, `${role}-user`));
      expect(forbiddenRes.status).toBe(403);

      const forbiddenMetricsRes = await request(app)
        .get("/api/admin/metrics")
        .set(authHeaderFor(role, `${role}-user`));
      expect(forbiddenMetricsRes.status).toBe(403);

      const forbiddenOrdersRes = await request(app)
        .get("/api/admin/dashboard/orders")
        .set(authHeaderFor(role, `${role}-user`));
      expect(forbiddenOrdersRes.status).toBe(403);
    }
  });

  it("artist dashboard summary and orders return payload and block non-artist roles", async () => {
    getDb.mockReturnValue(createDashboardDb());
    dashboardService.getArtistDashboardSummary.mockResolvedValue({
      totalOrders: 2,
      totalUnits: 3,
      grossCents: 3998,
      byStatus: { placed: 1, cancelled: 0, fulfilled: 1 },
    });
    dashboardService.getArtistDashboardOrders.mockResolvedValue([
      {
        orderId: "order-1",
        status: "placed",
        totalCents: 1999,
        createdAt: "2026-03-08T00:00:00.000Z",
        buyerUserId: "buyer-user",
        items: [{ productId: "product-1", productVariantId: "variant-1", quantity: 1, priceCents: 1999 }],
      },
    ]);

    const summaryRes = await request(app)
      .get("/api/artist/dashboard/summary")
      .set(authHeaderFor("artist", "artist-user"));
    expect(summaryRes.status).toBe(200);
    expect(typeof summaryRes.body?.totalOrders).toBe("number");
    expect(typeof summaryRes.body?.totalUnits).toBe("number");
    expect(typeof summaryRes.body?.grossCents).toBe("number");

    const ordersRes = await request(app)
      .get("/api/artist/dashboard/orders")
      .set(authHeaderFor("artist", "artist-user"));
    expect(ordersRes.status).toBe(200);
    expect(Array.isArray(ordersRes.body?.items)).toBe(true);

    for (const role of ["buyer", "admin", "label"]) {
      const forbiddenSummary = await request(app)
        .get("/api/artist/dashboard/summary")
        .set(authHeaderFor(role, `${role}-user`));
      expect(forbiddenSummary.status).toBe(403);
    }
  });

  it("label dashboard summary/detail/orders contracts work and cross-role access is forbidden", async () => {
    getDb.mockReturnValue(createDashboardDb());
    labelsDashboardService.getLabelDashboardSummary.mockResolvedValue({
      totalArtists: 1,
      activeArtists30d: 1,
      inactiveArtists: 0,
      grossCents: 4200,
      artists: [
        {
          artistId: "artist-1",
          artistName: "Artist One",
          orders30d: 1,
          gross30d: 4200,
          units30d: 2,
          activeProductsCount: 1,
        },
      ],
    });
    labelsDashboardService.getLabelDashboardOrders.mockResolvedValue({
      orders: [
        {
          orderId: "order-1",
          status: "fulfilled",
          totalCents: 4200,
          createdAt: "2026-03-08T00:00:00.000Z",
          buyerUserId: "buyer-user",
          items: [
            {
              productId: "product-1",
              productVariantId: "variant-1",
              quantity: 1,
              priceCents: 4200,
              artistId: "artist-1",
            },
          ],
        },
      ],
      meta: { status: "all", range: "30d", limit: 10 },
    });
    labelsDashboardService.getLabelArtistSummary.mockResolvedValue({
      artistId: "artist-1",
      artistName: "Artist One",
      orders30d: 1,
      gross30d: 4200,
      units30d: 2,
      activeProductsCount: 1,
    });

    const summaryRes = await request(app)
      .get("/api/labels/dashboard/summary")
      .set(authHeaderFor("label", "label-user"));
    expect(summaryRes.status).toBe(200);
    expect(typeof summaryRes.body?.totalArtists).toBe("number");
    expect(Array.isArray(summaryRes.body?.artists)).toBe(true);

    labelsDashboardService.resolveLabelIdForUser.mockResolvedValueOnce(null);
    const emptySummaryRes = await request(app)
      .get("/api/labels/dashboard/summary")
      .set(authHeaderFor("label", "label-user"));
    expect(emptySummaryRes.status).toBe(200);
    expect(typeof emptySummaryRes.body?.totalArtists).toBe("number");
    expect(Array.isArray(emptySummaryRes.body?.artists)).toBe(true);

    const detailRes = await request(app)
      .get("/api/labels/dashboard/artists/artist-1/summary")
      .set(authHeaderFor("label", "label-user"));
    expect(detailRes.status).toBe(200);
    expect(detailRes.body?.artistId).toBe("artist-1");

    const ordersRes = await request(app)
      .get("/api/labels/dashboard/orders?status=all&range=30d&limit=10")
      .set(authHeaderFor("label", "label-user"));
    expect(ordersRes.status).toBe(200);
    expect(Array.isArray(ordersRes.body?.orders || ordersRes.body?.items)).toBe(true);

    const aliasSummaryRes = await request(app)
      .get("/api/label/dashboard/summary")
      .set(authHeaderFor("label", "label-user"));
    expect(aliasSummaryRes.status).toBe(200);
    expect(aliasSummaryRes.body).toEqual(summaryRes.body);

    const aliasDetailRes = await request(app)
      .get("/api/label/dashboard/artists/artist-1/summary")
      .set(authHeaderFor("label", "label-user"));
    expect(aliasDetailRes.status).toBe(200);
    expect(aliasDetailRes.body).toEqual(detailRes.body);

    for (const role of ["buyer", "artist", "admin"]) {
      const forbiddenRes = await request(app)
        .get("/api/labels/dashboard/summary")
        .set(authHeaderFor(role, `${role}-user`));
      expect(forbiddenRes.status).toBe(403);

      const forbiddenOrdersRes = await request(app)
        .get("/api/labels/dashboard/orders")
        .set(authHeaderFor(role, `${role}-user`));
      expect(forbiddenOrdersRes.status).toBe(403);
    }

    ownership.isLabelLinkedToArtist.mockResolvedValueOnce(false);
    const unmappedDetailRes = await request(app)
      .get("/api/labels/dashboard/artists/artist-foreign/summary")
      .set(authHeaderFor("label", "label-user"));
    expect(unmappedDetailRes.status).toBe(403);
  });
});
