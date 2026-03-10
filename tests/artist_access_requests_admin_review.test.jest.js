const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { verifyPassword } = require("../src/utils/password");
const { silenceTestLogs } = require("./helpers/logging");

const DB_MODULE_PATH = path.resolve(__dirname, "../src/core/db/db.js");
const ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/artistAccessRequests.admin.routes.js"
);
const AUTH_ROUTE_MODULE_PATH = path.resolve(__dirname, "../src/routes/auth.routes.js");
const EMAIL_SERVICE_MODULE_PATH = path.resolve(__dirname, "../src/services/email.service.js");

const REQUEST_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const ORIGINAL_PREMIUM_PLAN_ENABLED = process.env.PREMIUM_PLAN_ENABLED;
let restoreLogs = () => {};

const clearModules = () => {
  jest.resetModules();
};

const pickColumns = (row, cols) => {
  if (!Array.isArray(cols) || cols.length === 0) return { ...row };
  const out = {};
  for (const col of cols) {
    out[col] = row[col];
  }
  return out;
};

const createFakeDb = (options = {}) => {
  const nowIso = "2026-03-03T10:00:00.000Z";
  const state = {
    request: {
      id: REQUEST_ID,
      status: options.requestStatus || "pending",
      artist_name: "Approve Test Artist",
      handle: "approve-test-artist",
      email: "approve-test@example.com",
      phone: "1234567890",
      requested_plan_type: options.requestedPlanType || "advanced",
      created_at: nowIso,
      updated_at: nowIso,
    },
    users: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        email: "approve-test@example.com",
        password_hash: "old-hash",
        role: "fan",
      },
    ],
    artists: [],
    artistUserMap: [],
    labelArtistMap: [],
    artistSubscriptions: options.existingActiveSubscription
      ? [
          {
            id: "sub-existing",
            artist_id: "placeholder-artist",
            status: "active",
          },
        ]
      : [],
    authRefreshTokens: [],
  };

  const normalizeKey = (key) => String(key || "").split(".").pop();
  const hasTable = (tableName) =>
    !["entity_media_links", "media_assets"].includes(String(tableName || ""));

  const makeQuery = (rawTableName) => {
    const tableName = String(rawTableName || "").split(/\s+as\s+/i)[0].trim();
    const ctx = {
      whereObj: {},
      whereRules: [],
      whereRawSql: "",
      whereRawArgs: [],
      limit: null,
      offset: 0,
      order: [],
      countSpec: null,
    };

    const applyWhere = (rows) =>
      rows.filter((row) => {
        const matchesObject = Object.entries(ctx.whereObj || {}).every(([key, value]) => {
          const normalized = normalizeKey(key);
          return row[normalized] === value;
        });
        if (!matchesObject) return false;
        return ctx.whereRules.every((rule) => {
          const value = row[normalizeKey(rule.column)];
          if (rule.op === "=") return value === rule.value;
          if (rule.op === ">") return value > rule.value;
          return false;
        });
      });

    const applySort = (rows) => {
      if (!ctx.order.length) return rows;
      return rows.slice().sort((a, b) => {
        for (const order of ctx.order) {
          const key = normalizeKey(order.column);
          const left = a[key];
          const right = b[key];
          if (left === right) continue;
          const factor = order.direction === "asc" ? 1 : -1;
          return left > right ? factor : -factor;
        }
        return 0;
      });
    };

    const execute = () => {
      let rows = [];
      if (tableName === "artist_access_requests") {
        rows = [state.request];
      } else if (tableName === "artist_subscriptions") {
        rows = state.artistSubscriptions.slice();
      } else if (tableName === "artist_user_map") {
        rows = state.artistUserMap.slice();
      } else if (tableName === "label_artist_map") {
        rows = state.labelArtistMap.slice();
      } else if (tableName === "artists") {
        rows = state.artists.slice();
      } else if (tableName === "users") {
        rows = state.users.slice();
      } else if (tableName === "auth_refresh_tokens") {
        rows = state.authRefreshTokens.slice();
      } else {
        rows = [];
      }

      if (tableName === "users" && ctx.whereRawSql && ctx.whereRawArgs.length > 0) {
        const wantedEmail = String(ctx.whereRawArgs[0] || "").toLowerCase().trim();
        rows = rows.filter(
          (user) => String(user.email || "").toLowerCase().trim() === wantedEmail
        );
      }
      if (tableName === "artists" && ctx.whereRawSql && ctx.whereRawArgs.length > 0) {
        const wantedHandle = String(ctx.whereRawArgs[0] || "").toLowerCase().trim();
        rows = rows.filter(
          (artist) => String(artist.handle || "").toLowerCase().trim() === wantedHandle
        );
      }

      rows = applyWhere(rows);
      if (ctx.countSpec) {
        let countKey = "count";
        if (typeof ctx.countSpec === "object" && ctx.countSpec) {
          countKey = Object.keys(ctx.countSpec)[0] || "count";
        }
        return [{ [countKey]: rows.length }];
      }

      rows = applySort(rows);
      if (typeof ctx.offset === "number" && ctx.offset > 0) {
        rows = rows.slice(ctx.offset);
      }
      if (typeof ctx.limit === "number") {
        rows = rows.slice(0, ctx.limit);
      }
      return rows;
    };

    const q = {
      select() {
        return q;
      },
      where(arg1, arg2, arg3) {
        if (arg1 && typeof arg1 === "object" && arg2 === undefined) {
          ctx.whereObj = { ...(ctx.whereObj || {}), ...(arg1 || {}) };
          return q;
        }
        if (arg3 === undefined) {
          ctx.whereRules.push({ column: arg1, op: "=", value: arg2 });
        } else {
          ctx.whereRules.push({ column: arg1, op: String(arg2 || "="), value: arg3 });
        }
        return q;
      },
      andWhere(arg1, arg2, arg3) {
        return q.where(arg1, arg2, arg3);
      },
      whereNull() {
        return q;
      },
      whereRaw(sql, args) {
        ctx.whereRawSql = String(sql || "");
        ctx.whereRawArgs = Array.isArray(args) ? args : [];
        return q;
      },
      orderBy(column, direction = "asc") {
        ctx.order.push({
          column,
          direction: String(direction || "asc").toLowerCase() === "asc" ? "asc" : "desc",
        });
        return q;
      },
      orderByRaw() {
        return q;
      },
      limit(value) {
        ctx.limit = Number(value);
        return q;
      },
      offset(value) {
        ctx.offset = Number(value) || 0;
        return q;
      },
      count(spec) {
        ctx.countSpec = spec;
        return q;
      },
      leftJoin() {
        return q;
      },
      async first(...cols) {
        const row = execute()[0] || null;
        return row ? pickColumns(row, cols) : null;
      },
      async columnInfo() {
        if (tableName === "artist_access_requests") {
          return {
            id: {},
            status: {},
            requested_plan_type: {},
            approved_plan_type: {},
            decided_at: {},
            decided_by_user_id: {},
            updated_at: {},
            rejection_comment: {},
            requestor_user_id: {},
            created_at: {},
          };
        }
        if (tableName === "artists") {
          return {
            id: {},
            handle: {},
            name: {},
            created_at: {},
            updated_at: {},
            email: {},
            phone: {},
            about_me: {},
            message_for_fans: {},
            socials: {},
          };
        }
        if (tableName === "artist_subscriptions") {
          return {
            id: {},
            artist_id: {},
            requested_plan_type: {},
            approved_plan_type: {},
            start_date: {},
            end_date: {},
            payment_mode: {},
            transaction_id: {},
            approved_by_admin_id: {},
            approved_at: {},
            status: {},
            created_at: {},
            updated_at: {},
          };
        }
        return {};
      },
      async update(updates) {
        const rows = execute();
        if (tableName === "artist_access_requests") {
          if (!rows.length) return 0;
          state.request = { ...state.request, ...updates };
          return 1;
        }
        if (tableName === "users") {
          let updated = 0;
          state.users = state.users.map((row) => {
            if (!rows.some((candidate) => candidate.id === row.id)) return row;
            updated += 1;
            return { ...row, ...updates };
          });
          return updated;
        }
        if (tableName === "artists") {
          let updated = 0;
          state.artists = state.artists.map((row) => {
            if (!rows.some((candidate) => candidate.id === row.id)) return row;
            updated += 1;
            return { ...row, ...updates };
          });
          return updated;
        }
        return 0;
      },
      insert(payload) {
        const row = { ...payload };
        if (tableName === "artists") {
          state.artists.push(row);
        } else if (tableName === "users") {
          state.users.push(row);
        } else if (tableName === "artist_user_map") {
          state.artistUserMap.push(row);
        } else if (tableName === "label_artist_map") {
          state.labelArtistMap.push(row);
        } else if (tableName === "artist_subscriptions") {
          if (!row.id) row.id = `sub-${state.artistSubscriptions.length + 1}`;
          state.artistSubscriptions.push(row);
        } else if (tableName === "auth_refresh_tokens") {
          state.authRefreshTokens.push(row);
        }

        return {
          returning: async (cols) => [pickColumns(row, cols)],
          onConflict: () => ({
            ignore: async () => undefined,
          }),
        };
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

    return q;
  };

  const db = (tableName) => makeQuery(tableName);
  db.fn = { now: () => nowIso };
  db.raw = () => null;
  db.schema = {
    hasTable: async (tableName) => hasTable(tableName),
  };
  db.transaction = async (cb) => {
    const trx = (tableName) => makeQuery(tableName);
    trx.fn = { now: () => nowIso };
    trx.raw = () => null;
    trx.schema = {
      hasTable: async (tableName) => hasTable(tableName),
    };
    return cb(trx);
  };

  return { db, state };
};

const loadActionWithDb = (db) => {
  clearModules();
  const dbModule = require(DB_MODULE_PATH);
  dbModule.getDb = () => db;
  const routeModule = require(ROUTE_MODULE_PATH);
  return routeModule.__test.approveArtistRequestAction;
};

const loadRouterWithDb = (db) => {
  clearModules();
  const dbModule = require(DB_MODULE_PATH);
  dbModule.getDb = () => db;
  return require(ROUTE_MODULE_PATH);
};

const createApiAppWithDb = (db, { sendEmailByTemplate } = {}) => {
  clearModules();
  const emailMock =
    sendEmailByTemplate ||
    jest.fn().mockResolvedValue({
      attempted: true,
      delivered: true,
      queued: true,
      skipped: false,
    });
  jest.doMock(DB_MODULE_PATH, () => ({
    getDb: () => db,
  }));
  jest.doMock(EMAIL_SERVICE_MODULE_PATH, () => ({
    sendEmailByTemplate: emailMock,
  }));
  jest.doMock("../src/core/http/auth.middleware", () => ({
    requireAuth: (req, res, next) => {
      const userId = String(req.headers["x-test-user-id"] || "").trim();
      const role = String(req.headers["x-test-role"] || "").trim() || "fan";
      if (!userId) {
        return res.status(401).json({ error: "unauthorized" });
      }
      req.user = { id: userId, role };
      return next();
    },
  }));
  jest.doMock("../src/core/http/policy.middleware", () => ({
    requirePolicy: () => (_req, _res, next) => next(),
  }));

  const adminRequestsRouter = require(ROUTE_MODULE_PATH);
  const authRouter = require(AUTH_ROUTE_MODULE_PATH);
  const app = express();
  app.use(express.json());
  app.use("/api/admin/artist-access-requests", adminRequestsRouter);
  app.use("/api/auth", authRouter);
  app.__sendEmailByTemplate = emailMock;
  return app;
};

const createMockResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const getRejectHandler = (router) => {
  const layer = router.stack.find(
    (entry) => entry?.route?.path === "/:id/reject" && entry?.route?.methods?.post
  );
  if (!layer) {
    throw new Error("POST /:id/reject route handler not found");
  }
  const handlers = Array.isArray(layer.route.stack) ? layer.route.stack : [];
  if (!handlers.length) {
    throw new Error("POST /:id/reject handlers are empty");
  }
  return handlers[handlers.length - 1].handle;
};

afterEach(() => {
  process.env.PREMIUM_PLAN_ENABLED = ORIGINAL_PREMIUM_PLAN_ENABLED;
  clearModules();
});

beforeAll(() => {
  restoreLogs = silenceTestLogs(["log", "warn"]);
});

afterAll(() => {
  restoreLogs();
});

describe("artist access request admin review", () => {
  it("pending list mapping preserves requested_plan_type", () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { mapRow, ADMIN_REQUEST_LIST_COLUMNS } = routeModule.__test;

    expect(ADMIN_REQUEST_LIST_COLUMNS.includes("requested_plan_type")).toBe(true);

    const mapped = mapRow({
      id: "r1",
      status: "pending",
      requested_plan_type: "advanced",
    });

    expect(mapped.requested_plan_type).toBe("advanced");
  });

  it("pending list API returns pending requests with requested_plan_type", async () => {
    const { db } = createFakeDb({ requestedPlanType: "advanced" });
    const app = createApiAppWithDb(db);

    const response = await request(app)
      .get("/api/admin/artist-access-requests?status=pending&page=1&pageSize=20")
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "admin");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body?.items)).toBe(true);
    expect(response.body?.total).toBe(1);
    expect(response.body.items[0]?.id).toBe(REQUEST_ID);
    expect(response.body.items[0]?.requested_plan_type).toBe("advanced");
  });

  it("approved requestor can log in via partner portal", async () => {
    const approvalPassword = "ApproveLogin123!";
    const { db, state } = createFakeDb({ requestedPlanType: "basic" });
    const sendEmailByTemplate = jest.fn().mockResolvedValue({
      attempted: true,
      delivered: true,
      queued: true,
      skipped: false,
    });
    const app = createApiAppWithDb(db, { sendEmailByTemplate });

    const approveResponse = await request(app)
      .post(`/api/admin/artist-access-requests/${REQUEST_ID}/approve`)
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "admin")
      .send({
        final_plan_type: "advanced",
        payment_mode: "cash",
        transaction_id: "TX-INTEGRATION",
        password: approvalPassword,
      });
    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body?.status).toBe("approved");
    expect(state.request.status).toBe("approved");
    expect(state.artistUserMap.length).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendEmailByTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "admin-approved-account",
        to: "approve-test@example.com",
      })
    );

    const partnerLoginResponse = await request(app).post("/api/auth/partner/login").send({
      email: state.request.email,
      password: approvalPassword,
    });
    expect(partnerLoginResponse.status).toBe(200);
    expect(partnerLoginResponse.body?.user?.role).toBe("artist");
    expect(typeof partnerLoginResponse.body?.accessToken).toBe("string");
  }, 20000);

  it("approving basic sets payment NA and creates active subscription", async () => {
    const { db, state } = createFakeDb({ requestedPlanType: "advanced" });
    const approveArtistRequestAction = loadActionWithDb(db);

    const approval = await approveArtistRequestAction({
      id: REQUEST_ID,
      adminId: ADMIN_ID,
      body: {
        final_plan_type: "basic",
        password: "AdminSet123!",
      },
    });

    expect(approval.httpStatus).toBe(200);
    expect(state.artistSubscriptions.length).toBe(1);
    expect(state.artistSubscriptions[0].status).toBe("active");
    expect(state.artistSubscriptions[0].approved_plan_type).toBe("basic");
    expect(state.artistSubscriptions[0].requested_plan_type).toBe("advanced");
    expect(state.artistSubscriptions[0].payment_mode).toBe("NA");
    expect(state.artistSubscriptions[0].transaction_id).toBe("NA");
    expect(state.request.status).toBe("approved");
    expect(state.request.approved_plan_type).toBe("basic");
  });

  it("approving advanced without payment fields returns 400", async () => {
    const { db } = createFakeDb({ requestedPlanType: "advanced" });
    const approveArtistRequestAction = loadActionWithDb(db);

    await expect(
      approveArtistRequestAction({
        id: REQUEST_ID,
        adminId: ADMIN_ID,
        body: {
          final_plan_type: "advanced",
          password: "AdminSet123!",
        },
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("approving advanced with online tx creates subscription", async () => {
    const { db, state } = createFakeDb({ requestedPlanType: "basic" });
    const approveArtistRequestAction = loadActionWithDb(db);

    const approval = await approveArtistRequestAction({
      id: REQUEST_ID,
      adminId: ADMIN_ID,
      body: {
        final_plan_type: "advanced",
        payment_mode: "online",
        transaction_id: "TX-123",
        password: "AdminSet123!",
      },
    });

    expect(approval.httpStatus).toBe(200);
    expect(state.artistSubscriptions.length).toBe(1);
    expect(state.artistSubscriptions[0].approved_plan_type).toBe("advanced");
    expect(state.artistSubscriptions[0].payment_mode).toBe("online");
    expect(state.artistSubscriptions[0].transaction_id).toBe("TX-123");
    expect(state.users.length).toBe(1);
    expect(state.users[0].role).toBe("artist");
    expect(state.users[0].password_hash).toBeTruthy();
    expect(state.artistUserMap.length).toBe(1);
    const valid = await verifyPassword("AdminSet123!", state.users[0].password_hash);
    expect(valid).toBe(true);
  }, 20000);

  it("approving premium while disabled returns 400", async () => {
    process.env.PREMIUM_PLAN_ENABLED = "false";
    const { db } = createFakeDb({ requestedPlanType: "basic" });
    const approveArtistRequestAction = loadActionWithDb(db);

    await expect(
      approveArtistRequestAction({
        id: REQUEST_ID,
        adminId: ADMIN_ID,
        body: {
          final_plan_type: "premium",
          payment_mode: "online",
          transaction_id: "TX-PREMIUM",
          password: "AdminSet123!",
        },
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("approving same request twice does not create second active subscription", async () => {
    const { db, state } = createFakeDb({ requestedPlanType: "basic" });
    const approveArtistRequestAction = loadActionWithDb(db);

    const first = await approveArtistRequestAction({
      id: REQUEST_ID,
      adminId: ADMIN_ID,
      body: {
        final_plan_type: "advanced",
        payment_mode: "cash",
        transaction_id: "TX-1",
        password: "AdminSet123!",
      },
    });
    expect(first.httpStatus).toBe(200);
    expect(state.artistSubscriptions.length).toBe(1);

    const second = await approveArtistRequestAction({
      id: REQUEST_ID,
      adminId: ADMIN_ID,
      body: {
        final_plan_type: "advanced",
        payment_mode: "cash",
        transaction_id: "TX-2",
        password: "AdminSet123!",
      },
    });
    expect(second.httpStatus).toBe(409);
    expect(state.artistSubscriptions.length).toBe(1);
  });

  it("approving without password returns 400", async () => {
    const { db } = createFakeDb({ requestedPlanType: "basic" });
    const approveArtistRequestAction = loadActionWithDb(db);

    try {
      await approveArtistRequestAction({
        id: REQUEST_ID,
        adminId: ADMIN_ID,
        body: {
          final_plan_type: "basic",
        },
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ status: 400 });
      expect(String(error?.message || "")).toMatch(/password/i);
    }
  });

  it("rejecting a pending request sets status=rejected without approval password", async () => {
    const { db, state } = createFakeDb({ requestedPlanType: "basic" });
    const router = loadRouterWithDb(db);
    const handler = getRejectHandler(router);
    const req = {
      params: { id: REQUEST_ID },
      body: { comment: "Smoke reject validation" },
      user: { id: ADMIN_ID, role: "admin" },
    };
    const res = createMockResponse();

    await handler(req, res, () => null);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "rejected" });
    expect(state.request.status).toBe("rejected");
    expect(state.request.rejection_comment).toBe("Smoke reject validation");
  });

  it("reject API sends admin-rejected-account email through shared sender", async () => {
    const { db } = createFakeDb({ requestedPlanType: "basic" });
    const sendEmailByTemplate = jest.fn().mockResolvedValue({
      attempted: true,
      delivered: true,
      queued: true,
      skipped: false,
    });
    const app = createApiAppWithDb(db, { sendEmailByTemplate });

    const rejectResponse = await request(app)
      .post(`/api/admin/artist-access-requests/${REQUEST_ID}/reject`)
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "admin")
      .send({ comment: "Not enough portfolio depth yet" });

    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body?.status).toBe("rejected");
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendEmailByTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "admin-rejected-account",
        to: "approve-test@example.com",
      })
    );
  });

  it("approval and rejection still succeed when email sender fails", async () => {
    const failingSend = jest.fn().mockRejectedValue(new Error("email_down"));
    const approveDb = createFakeDb({ requestedPlanType: "basic" }).db;
    const approveApp = createApiAppWithDb(approveDb, { sendEmailByTemplate: failingSend });

    const approveResponse = await request(approveApp)
      .post(`/api/admin/artist-access-requests/${REQUEST_ID}/approve`)
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "admin")
      .send({
        final_plan_type: "advanced",
        payment_mode: "cash",
        transaction_id: "TX-EMAIL-FAIL",
        password: "AdminSet123!",
      });
    expect(approveResponse.status).toBe(200);

    const rejectDb = createFakeDb({ requestedPlanType: "basic" }).db;
    const rejectApp = createApiAppWithDb(rejectDb, { sendEmailByTemplate: failingSend });
    const rejectResponse = await request(rejectApp)
      .post(`/api/admin/artist-access-requests/${REQUEST_ID}/reject`)
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "admin")
      .send({ comment: "Missing required details" });
    expect(rejectResponse.status).toBe(200);
  });
});

