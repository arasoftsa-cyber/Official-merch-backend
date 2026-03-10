const path = require("node:path");
const { silenceTestLogs } = require("./helpers/logging");

const DB_MODULE_PATH = path.resolve(__dirname, "../src/core/db/db.js");
const SERVICE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/services/artistAccessRequests.service.js"
);

const ORIGINAL_PREMIUM_PLAN_ENABLED = process.env.PREMIUM_PLAN_ENABLED;
let restoreLogs = () => {};

const clearModules = () => {
  jest.resetModules();
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
        if (String(tableName || "").includes("artist_access_requests")) {
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

beforeAll(() => {
  restoreLogs = silenceTestLogs(["log", "warn"]);
});

afterAll(() => {
  restoreLogs();
});

describe("artist access request submission", () => {
  it("missing requested_plan_type returns 400 validation", async () => {
    const { db, state } = createFakeDb();
    const { submitArtistAccessRequest } = loadServiceWithDb(db);

    try {
      await submitArtistAccessRequest({ rawBody: buildValidRawBody() });
      throw new Error("expected validation rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "validation" });
      expect(error).toMatchObject({
        details: expect.arrayContaining([
          expect.objectContaining({ field: "requested_plan_type" }),
        ]),
      });
    }

    expect(state.insertedRequests.length).toBe(0);
  });

  it("premium plan returns 400 when premium is disabled", async () => {
    process.env.PREMIUM_PLAN_ENABLED = "false";
    const { db, state } = createFakeDb();
    const { submitArtistAccessRequest } = loadServiceWithDb(db);

    try {
      await submitArtistAccessRequest({
        rawBody: buildValidRawBody({ requested_plan_type: "premium" }),
      });
      throw new Error("expected validation rejection");
    } catch (error) {
      expect(Array.isArray(error?.details)).toBe(true);
      expect(
        error.details.some(
          (row) =>
            row.field === "requested_plan_type" &&
            /not enabled/i.test(String(row.message || ""))
        )
      ).toBe(true);
    }

    expect(state.insertedRequests.length).toBe(0);
  });

  it("basic and advanced plans are saved as requested_plan_type", async () => {
    process.env.PREMIUM_PLAN_ENABLED = "false";
    for (const sample of [
      { field: "requested_plan_type", value: "basic", expected: "basic" },
      { field: "planType", value: "Advanced", expected: "advanced" },
    ]) {
      const { db, state } = createFakeDb();
      const { submitArtistAccessRequest } = loadServiceWithDb(db);
      const rawBody = buildValidRawBody({ [sample.field]: sample.value });
      const result = await submitArtistAccessRequest({ rawBody });

      expect(result?.request_id).toBeTruthy();
      expect(state.insertedRequests.length).toBe(1);
      expect(state.insertedRequests[0].requested_plan_type).toBe(sample.expected);
      expect(state.insertedRequests[0].status).toBe("pending");
      expect(state.touchedTables.includes("leads")).toBe(false);
      expect(state.touchedTables.includes("artist_subscriptions")).toBe(false);
    }
  });
});

