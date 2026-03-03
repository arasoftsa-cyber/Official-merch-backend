const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test, afterEach } = require("node:test");

const DB_MODULE_PATH = path.resolve(__dirname, "../src/core/db/db.js");
const ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/artistAccessRequests/artistAccessRequests.admin.routes.js"
);

const REQUEST_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const ORIGINAL_PREMIUM_PLAN_ENABLED = process.env.PREMIUM_PLAN_ENABLED;

const clearModules = () => {
  delete require.cache[DB_MODULE_PATH];
  delete require.cache[ROUTE_MODULE_PATH];
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
  const state = {
    request: {
      id: REQUEST_ID,
      status: options.requestStatus || "pending",
      artist_name: "Approve Test Artist",
      handle: "approve-test-artist",
      email: "approve-test@example.com",
      phone: "1234567890",
      requested_plan_type: options.requestedPlanType || "advanced",
    },
    users: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        email: "approve-test@example.com",
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
  };

  const nowIso = "2026-03-03T10:00:00.000Z";

  const makeQuery = (tableName) => {
    const ctx = {
      whereObj: null,
      whereRawSql: "",
      whereRawArgs: [],
    };

    const q = {
      select() {
        return q;
      },
      where(whereObj) {
        ctx.whereObj = { ...(ctx.whereObj || {}), ...(whereObj || {}) };
        return q;
      },
      whereRaw(sql, args) {
        ctx.whereRawSql = String(sql || "");
        ctx.whereRawArgs = Array.isArray(args) ? args : [];
        return q;
      },
      async first(...cols) {
        if (tableName === "artist_access_requests") {
          if (ctx.whereObj?.id && ctx.whereObj.id !== state.request.id) return null;
          return pickColumns(state.request, cols);
        }
        if (tableName === "users") {
          const wantedEmail = String(ctx.whereRawArgs?.[0] || "").toLowerCase().trim();
          const row = state.users.find(
            (u) => String(u.email || "").toLowerCase().trim() === wantedEmail
          );
          return row ? pickColumns(row, cols) : null;
        }
        if (tableName === "artists") {
          const wantedHandle = String(ctx.whereRawArgs?.[0] || "").toLowerCase().trim();
          const row = state.artists.find(
            (artist) => String(artist.handle || "").toLowerCase().trim() === wantedHandle
          );
          if (row) return pickColumns(row, cols);
          if (ctx.whereObj?.id) {
            const byId = state.artists.find((artist) => artist.id === ctx.whereObj.id);
            return byId ? pickColumns(byId, cols) : null;
          }
          return null;
        }
        if (tableName === "artist_subscriptions") {
          const row = state.artistSubscriptions.find((subscription) =>
            Object.entries(ctx.whereObj || {}).every(
              ([key, value]) => subscription[key] === value
            )
          );
          return row ? pickColumns(row, cols) : null;
        }
        if (tableName === "entity_media_links") {
          return null;
        }
        return null;
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
        if (tableName === "artist_access_requests" && ctx.whereObj?.id === state.request.id) {
          state.request = { ...state.request, ...updates };
          return 1;
        }
        if (tableName === "users" && ctx.whereObj?.id) {
          const idx = state.users.findIndex((row) => row.id === ctx.whereObj.id);
          if (idx >= 0) {
            state.users[idx] = { ...state.users[idx], ...updates };
            return 1;
          }
          return 0;
        }
        if (tableName === "artists" && ctx.whereObj?.id) {
          const idx = state.artists.findIndex((row) => row.id === ctx.whereObj.id);
          if (idx >= 0) {
            state.artists[idx] = { ...state.artists[idx], ...updates };
            return 1;
          }
          return 0;
        }
        return 0;
      },
      insert(payload) {
        const row = { ...payload };
        if (tableName === "artists") {
          state.artists.push(row);
        } else if (tableName === "artist_user_map") {
          state.artistUserMap.push(row);
        } else if (tableName === "label_artist_map") {
          state.labelArtistMap.push(row);
        } else if (tableName === "artist_subscriptions") {
          if (!row.id) row.id = `sub-${state.artistSubscriptions.length + 1}`;
          if (options.existingActiveSubscription) {
            row.id = "sub-blocked";
          }
          state.artistSubscriptions.push(row);
        }

        return {
          returning: async (cols) => [pickColumns(row, cols)],
          onConflict: () => ({
            ignore: async () => undefined,
          }),
        };
      },
    };

    return q;
  };

  const db = (tableName) => makeQuery(tableName);
  db.fn = { now: () => nowIso };
  db.schema = {
    hasTable: async () => true,
  };
  db.transaction = async (cb) => {
    const trx = (tableName) => makeQuery(tableName);
    trx.fn = { now: () => nowIso };
    trx.schema = {
      hasTable: async () => true,
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

afterEach(() => {
  process.env.PREMIUM_PLAN_ENABLED = ORIGINAL_PREMIUM_PLAN_ENABLED;
  clearModules();
});

describe("admin approval subscriptions", { concurrency: false }, () => {
  test("approving basic sets payment NA and creates active subscription", async () => {
    const { db, state } = createFakeDb({ requestedPlanType: "advanced" });
    const approveArtistRequestAction = loadActionWithDb(db);

    const approval = await approveArtistRequestAction({
      id: REQUEST_ID,
      adminId: ADMIN_ID,
      body: { final_plan_type: "basic" },
    });

    assert.equal(approval.httpStatus, 200);
    assert.equal(state.artistSubscriptions.length, 1);
    assert.equal(state.artistSubscriptions[0].status, "active");
    assert.equal(state.artistSubscriptions[0].approved_plan_type, "basic");
    assert.equal(state.artistSubscriptions[0].requested_plan_type, "advanced");
    assert.equal(state.artistSubscriptions[0].payment_mode, "NA");
    assert.equal(state.artistSubscriptions[0].transaction_id, "NA");
    assert.equal(state.request.status, "approved");
    assert.equal(state.request.approved_plan_type, "basic");
  });

  test("approving advanced without payment fields returns 400", async () => {
    const { db } = createFakeDb({ requestedPlanType: "advanced" });
    const approveArtistRequestAction = loadActionWithDb(db);

    await assert.rejects(
      () =>
        approveArtistRequestAction({
          id: REQUEST_ID,
          adminId: ADMIN_ID,
          body: { final_plan_type: "advanced" },
        }),
      (error) => {
        assert.equal(error?.status, 400);
        return true;
      }
    );
  });

  test("approving advanced with online tx creates subscription", async () => {
    const { db, state } = createFakeDb({ requestedPlanType: "basic" });
    const approveArtistRequestAction = loadActionWithDb(db);

    const approval = await approveArtistRequestAction({
      id: REQUEST_ID,
      adminId: ADMIN_ID,
      body: {
        final_plan_type: "advanced",
        payment_mode: "online",
        transaction_id: "TX-123",
      },
    });

    assert.equal(approval.httpStatus, 200);
    assert.equal(state.artistSubscriptions.length, 1);
    assert.equal(state.artistSubscriptions[0].approved_plan_type, "advanced");
    assert.equal(state.artistSubscriptions[0].payment_mode, "online");
    assert.equal(state.artistSubscriptions[0].transaction_id, "TX-123");
  });

  test("approving premium while disabled returns 400", async () => {
    process.env.PREMIUM_PLAN_ENABLED = "false";
    const { db } = createFakeDb({ requestedPlanType: "basic" });
    const approveArtistRequestAction = loadActionWithDb(db);

    await assert.rejects(
      () =>
        approveArtistRequestAction({
          id: REQUEST_ID,
          adminId: ADMIN_ID,
          body: {
            final_plan_type: "premium",
            payment_mode: "online",
            transaction_id: "TX-PREMIUM",
          },
        }),
      (error) => {
        assert.equal(error?.status, 400);
        return true;
      }
    );
  });

  test("approving same request twice does not create second active subscription", async () => {
    const { db, state } = createFakeDb({ requestedPlanType: "basic" });
    const approveArtistRequestAction = loadActionWithDb(db);

    const first = await approveArtistRequestAction({
      id: REQUEST_ID,
      adminId: ADMIN_ID,
      body: {
        final_plan_type: "advanced",
        payment_mode: "cash",
        transaction_id: "TX-1",
      },
    });
    assert.equal(first.httpStatus, 200);
    assert.equal(state.artistSubscriptions.length, 1);

    const second = await approveArtistRequestAction({
      id: REQUEST_ID,
      adminId: ADMIN_ID,
      body: {
        final_plan_type: "advanced",
        payment_mode: "cash",
        transaction_id: "TX-2",
      },
    });
    assert.equal(second.httpStatus, 409);
    assert.equal(state.artistSubscriptions.length, 1);
  });
});
