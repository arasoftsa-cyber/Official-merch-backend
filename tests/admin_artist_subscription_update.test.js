const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");

const ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/orders/admin.routes.js"
);

const pickColumns = (row, cols) => {
  if (!Array.isArray(cols) || cols.length === 0) return { ...row };
  const out = {};
  for (const col of cols) out[col] = row[col];
  return out;
};

const createFakeDb = ({ subscriptions }) => {
  const state = {
    subscriptions: subscriptions.map((row) => ({ ...row })),
  };

  const makeQuery = (tableName) => {
    const ctx = {
      whereObj: {},
      exclude: null,
    };

    const query = {
      where(whereObj) {
        ctx.whereObj = { ...ctx.whereObj, ...(whereObj || {}) };
        return query;
      },
      andWhereNot(column, value) {
        ctx.exclude = { column, value };
        return query;
      },
      async first(...cols) {
        if (tableName !== "artist_subscriptions") return null;
        const row = state.subscriptions.find((subscription) => {
          const matchesWhere = Object.entries(ctx.whereObj).every(
            ([key, value]) => subscription[key] === value
          );
          if (!matchesWhere) return false;
          if (ctx.exclude && subscription[ctx.exclude.column] === ctx.exclude.value) {
            return false;
          }
          return true;
        });
        return row ? pickColumns(row, cols) : null;
      },
      update(updatePayload) {
        if (tableName !== "artist_subscriptions") {
          return {
            returning: async () => [],
          };
        }
        let updated = null;
        for (let i = 0; i < state.subscriptions.length; i += 1) {
          const current = state.subscriptions[i];
          const matchesWhere = Object.entries(ctx.whereObj).every(
            ([key, value]) => current[key] === value
          );
          if (!matchesWhere) continue;
          const next = { ...current, ...updatePayload };
          state.subscriptions[i] = next;
          updated = next;
          break;
        }
        return {
          returning: async () => (updated ? [updated] : []),
        };
      },
    };

    return query;
  };

  const db = (tableName) => makeQuery(tableName);
  db.fn = {
    now: () => "2026-03-03T12:00:00.000Z",
  };
  db.schema = {
    hasTable: async (tableName) => tableName === "artist_subscriptions",
  };

  return { db, state };
};

describe("admin artist subscription patch action", () => {
  test("PATCH endDate works", async () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { updateArtistSubscriptionAction } = routeModule.__test;
    const { db, state } = createFakeDb({
      subscriptions: [
        {
          id: "sub-1",
          artist_id: "artist-1",
          requested_plan_type: "basic",
          approved_plan_type: "advanced",
          start_date: "2026-01-01",
          end_date: "2027-01-08",
          payment_mode: "online",
          transaction_id: "TX-1",
          status: "active",
          approved_at: "2026-01-01T00:00:00.000Z",
          approved_by_admin_id: "admin-1",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await updateArtistSubscriptionAction({
      db,
      subscriptionId: "sub-1",
      payload: { endDate: "2027-02-01" },
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.endDate, "2027-02-01");
    assert.equal(state.subscriptions[0].end_date, "2027-02-01");
  });

  test("PATCH status=active fails when another active exists", async () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { updateArtistSubscriptionAction } = routeModule.__test;
    const { db } = createFakeDb({
      subscriptions: [
        {
          id: "sub-1",
          artist_id: "artist-1",
          requested_plan_type: "basic",
          approved_plan_type: "advanced",
          start_date: "2026-01-01",
          end_date: "2027-01-08",
          payment_mode: "online",
          transaction_id: "TX-1",
          status: "expired",
          approved_at: "2026-01-01T00:00:00.000Z",
          approved_by_admin_id: "admin-1",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "sub-2",
          artist_id: "artist-1",
          requested_plan_type: "basic",
          approved_plan_type: "advanced",
          start_date: "2026-01-01",
          end_date: "2027-01-08",
          payment_mode: "cash",
          transaction_id: "TX-2",
          status: "active",
          approved_at: "2026-01-01T00:00:00.000Z",
          approved_by_admin_id: "admin-1",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await updateArtistSubscriptionAction({
      db,
      subscriptionId: "sub-1",
      payload: { status: "active" },
    });

    assert.equal(result.statusCode, 409);
    assert.equal(result.body.error, "active_subscription_exists");
  });

  test("PATCH payment fields are rejected for basic plan", async () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { updateArtistSubscriptionAction } = routeModule.__test;
    const { db } = createFakeDb({
      subscriptions: [
        {
          id: "sub-1",
          artist_id: "artist-1",
          requested_plan_type: "basic",
          approved_plan_type: "basic",
          start_date: "2026-01-01",
          end_date: "2027-01-08",
          payment_mode: "NA",
          transaction_id: "NA",
          status: "active",
          approved_at: "2026-01-01T00:00:00.000Z",
          approved_by_admin_id: "admin-1",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await updateArtistSubscriptionAction({
      db,
      subscriptionId: "sub-1",
      payload: { paymentMode: "cash", transactionId: "TX-should-not-apply" },
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error, "validation_error");
  });
});
