const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test, afterEach } = require("node:test");

const DB_MODULE_PATH = path.resolve(__dirname, "../src/core/db/db.js");
const SERVICE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/artistAccessRequests/artistAccessRequests.service.js"
);

const ORIGINAL_PREMIUM_PLAN_ENABLED = process.env.PREMIUM_PLAN_ENABLED;

const clearModules = () => {
  delete require.cache[DB_MODULE_PATH];
  delete require.cache[SERVICE_MODULE_PATH];
};

const createFakeDb = () => {
  const state = {
    touchedTables: [],
    insertedRequests: [],
  };

  const createQuery = (tableName) => {
    const query = {
      whereRaw() {
        return query;
      },
      where() {
        return query;
      },
      first: async () => null,
      columnInfo: async () => ({
        id: {},
        artist_name: {},
        handle: {},
        email: {},
        phone: {},
        socials: {},
        about_me: {},
        message_for_fans: {},
        contact_email: {},
        contact_phone: {},
        pitch: {},
        status: {},
        created_at: {},
        updated_at: {},
        requested_plan_type: {},
      }),
      update: async () => 1,
      insert(payload) {
        state.touchedTables.push(tableName);
        if (tableName === "artist_access_requests") {
          state.insertedRequests.push(payload);
        }
        return {
          returning: async () => [
            {
              id: payload.id,
              created_at: "2026-03-03T00:00:00.000Z",
            },
          ],
        };
      },
    };
    return query;
  };

  const db = (tableName) => createQuery(tableName);
  db.schema = {
    hasTable: async (tableName) => tableName === "artist_access_requests",
  };
  db.fn = {
    now: () => "2026-03-03T00:00:00.000Z",
  };
  db.transaction = async (cb) => {
    const trx = (tableName) => createQuery(tableName);
    trx.fn = {
      now: () => "2026-03-03T00:00:00.000Z",
    };
    trx.raw = (sql, bindings) => ({ sql, bindings });
    return cb(trx);
  };

  return { db, state };
};

const loadServiceWithDb = (db) => {
  clearModules();
  const dbModule = require(DB_MODULE_PATH);
  dbModule.getDb = () => db;
  return require(SERVICE_MODULE_PATH);
};

const buildValidRawBody = (overrides = {}) => ({
  artistName: "Plan Test Artist",
  handle: "plan-test-artist",
  email: "plan-test-artist@example.com",
  phone: "1234567890",
  about: "about",
  message_for_fans: "message",
  socials: [],
  ...overrides,
});

afterEach(() => {
  process.env.PREMIUM_PLAN_ENABLED = ORIGINAL_PREMIUM_PLAN_ENABLED;
  clearModules();
});

describe("artist access request plan submission validation", { concurrency: false }, () => {
  test("missing requested_plan_type returns 400 validation", async () => {
    const { db, state } = createFakeDb();
    const { submitArtistAccessRequest } = loadServiceWithDb(db);

    await assert.rejects(
      () => submitArtistAccessRequest({ rawBody: buildValidRawBody() }),
      (error) => {
        assert.equal(error?.code, "validation");
        assert.ok(
          Array.isArray(error?.details) &&
            error.details.some((row) => row.field === "requested_plan_type")
        );
        return true;
      }
    );

    assert.equal(state.insertedRequests.length, 0);
  });

  test("premium plan returns 400 when premium is disabled", async () => {
    process.env.PREMIUM_PLAN_ENABLED = "false";
    const { db, state } = createFakeDb();
    const { submitArtistAccessRequest } = loadServiceWithDb(db);

    await assert.rejects(
      () =>
        submitArtistAccessRequest({
          rawBody: buildValidRawBody({ requested_plan_type: "premium" }),
        }),
      (error) => {
        assert.equal(error?.code, "validation");
        assert.ok(
          Array.isArray(error?.details) &&
            error.details.some(
              (row) =>
                row.field === "requested_plan_type" &&
                /not enabled/i.test(String(row.message || ""))
            )
        );
        return true;
      }
    );

    assert.equal(state.insertedRequests.length, 0);
  });

  test("basic and advanced plans are saved as requested_plan_type", async () => {
    process.env.PREMIUM_PLAN_ENABLED = "false";
    for (const sample of [
      { field: "requested_plan_type", value: "basic", expected: "basic" },
      { field: "planType", value: "Advanced", expected: "advanced" },
    ]) {
      const { db, state } = createFakeDb();
      const { submitArtistAccessRequest } = loadServiceWithDb(db);
      const rawBody = buildValidRawBody({ [sample.field]: sample.value });
      const result = await submitArtistAccessRequest({ rawBody });

      assert.ok(result?.request_id);
      assert.equal(state.insertedRequests.length, 1);
      assert.equal(state.insertedRequests[0].requested_plan_type, sample.expected);
      assert.equal(state.insertedRequests[0].status, "pending");
      assert.equal(state.touchedTables.includes("artist_subscriptions"), false);
    }
  });
});
