const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");

const ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/orders/admin.routes.js"
);

const createFakeDb = ({ hasSubscription = true } = {}) => {
  const state = {
    artist: { id: "artist-1" },
    subscription: hasSubscription
      ? {
          id: "sub-1",
          artist_id: "artist-1",
          requested_plan_type: "advanced",
          approved_plan_type: "advanced",
          start_date: "2026-03-03",
          end_date: "2027-03-10",
          payment_mode: "online",
          transaction_id: "TX-999",
          approved_by_admin_id: "admin-1",
          approved_at: "2026-03-03T10:00:00.000Z",
          status: "active",
          created_at: "2026-03-03T10:00:00.000Z",
          updated_at: "2026-03-03T10:00:00.000Z",
        }
      : null,
  };

  const buildQuery = (tableName) => {
    const ctx = { whereObj: {} };
    const query = {
      where(whereObj) {
        ctx.whereObj = { ...(ctx.whereObj || {}), ...(whereObj || {}) };
        return query;
      },
      orderBy() {
        return query;
      },
      async first() {
        if (tableName === "artists") {
          if (ctx.whereObj?.id === state.artist.id) return state.artist;
          return null;
        }
        if (tableName === "artist_subscriptions") {
          if (
            state.subscription &&
            ctx.whereObj?.artist_id === state.subscription.artist_id &&
            ctx.whereObj?.status === "active"
          ) {
            return state.subscription;
          }
          return null;
        }
        return null;
      },
      async columnInfo() {
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
    };
    return query;
  };

  const db = (tableName) => buildQuery(tableName);
  db.schema = {
    hasTable: async (tableName) =>
      tableName === "artists" || tableName === "artist_subscriptions",
  };
  return db;
};

describe("admin artist subscription read", () => {
  test("returns active subscription payload", async () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { fetchActiveArtistSubscriptionPayload } = routeModule.__test;
    const db = createFakeDb({ hasSubscription: true });

    const response = await fetchActiveArtistSubscriptionPayload(db, "artist-1");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.artistId, "artist-1");
    assert.equal(response.body.approvedPlanType, "advanced");
    assert.equal(response.body.requestedPlanType, "advanced");
  });

  test("returns null subscription when no active record exists", async () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { fetchActiveArtistSubscriptionPayload } = routeModule.__test;
    const db = createFakeDb({ hasSubscription: false });

    const response = await fetchActiveArtistSubscriptionPayload(db, "artist-1");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, null);
  });
});
