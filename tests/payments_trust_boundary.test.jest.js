process.env.NODE_ENV = "test";

const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { silenceTestLogs } = require("./helpers/logging");

const PAYMENTS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/payments.routes.js"
);
const EMAIL_SERVICE_MODULE_ID = "../src/services/email.service.js";
const EMAIL_SERVICE_MODULE_ID_NO_EXT = "../src/services/email.service";

const createState = () => ({
  users: [
    { id: "buyer-1", email: "buyer@example.com" },
    { id: "admin-1", email: "admin@example.com" },
  ],
  orders: [
    { id: "order-1", buyer_user_id: "buyer-1" },
  ],
  payments: [
    {
      id: "payment-1",
      order_id: "order-1",
      status: "pending",
      provider: "mock",
      currency: "INR",
    },
  ],
  payment_events: [],
  order_events: [],
  __nowTick: 0,
});

const normalizeTableName = (tableName) =>
  String(tableName || "")
    .trim()
    .split(/\s+as\s+/i)[0]
    .trim();

const columnKey = (columnName) => String(columnName || "").split(".").pop();

const pickColumns = (row, cols) => {
  if (!Array.isArray(cols) || cols.length === 0) return { ...row };
  const out = {};
  for (const col of cols) {
    out[columnKey(col)] = row[columnKey(col)];
  }
  return out;
};

const createDb = (state) => {
  const nowIso = () => {
    state.__nowTick += 1;
    return new Date(1741392000000 + state.__nowTick * 1000).toISOString();
  };

  const makeQuery = (tableName) => {
    const table = normalizeTableName(tableName);
    const filters = [];

    const rows = () => {
      const baseRows = Array.isArray(state[table]) ? state[table].map((row) => ({ ...row })) : [];
      return filters.reduce((acc, filter) => acc.filter(filter), baseRows);
    };

    const query = {
      where(arg1, arg2) {
        if (arg1 && typeof arg1 === "object" && arg2 === undefined) {
          Object.entries(arg1).forEach(([key, value]) => {
            const col = columnKey(key);
            filters.push((row) => row[col] === value);
          });
          return query;
        }
        const col = columnKey(arg1);
        filters.push((row) => row[col] === arg2);
        return query;
      },
      async first(...cols) {
        const row = rows()[0] || null;
        if (!row) return null;
        return pickColumns(row, cols);
      },
      async update(patch) {
        const matched = rows();
        matched.forEach((row) => {
          const target = state[table].find((entry) => entry.id === row.id) || row;
          Object.assign(target, patch || {});
        });
        return matched.length;
      },
      insert(payload) {
        const inserted = (Array.isArray(payload) ? payload : [payload]).map((row, index) => ({
          ...row,
          id: row.id || `${table}-${state[table].length + index + 1}`,
        }));
        state[table].push(...inserted);
        return {
          returning: async (cols) => inserted.map((row) => pickColumns(row, cols)),
        };
      },
      then(resolve, reject) {
        try {
          resolve(rows());
        } catch (error) {
          if (reject) reject(error);
          else throw error;
        }
      },
    };

    return query;
  };

  const db = (tableName) => makeQuery(tableName);
  db.fn = { now: nowIso };
  db.transaction = async (handler) => handler(db);
  return db;
};

const createHarness = ({ nodeEnv = "test", enableMockMutations = false } = {}) => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.ENABLE_MOCK_PAYMENT_MUTATIONS;
  process.env.NODE_ENV = nodeEnv;
  process.env.ENABLE_MOCK_PAYMENT_MUTATIONS = enableMockMutations ? "true" : "false";

  const state = createState();
  const db = createDb(state);
  const sendEmailByTemplate = jest.fn().mockResolvedValue({
    attempted: true,
    delivered: true,
    queued: true,
    skipped: false,
  });

  jest.resetModules();
  jest.doMock("../src/core/db/db.js", () => ({
    getDb: () => db,
  }));
  jest.doMock(EMAIL_SERVICE_MODULE_ID, () => ({
    sendEmailByTemplate,
  }));
  jest.doMock(EMAIL_SERVICE_MODULE_ID_NO_EXT, () => ({
    sendEmailByTemplate,
  }));
  jest.doMock("../src/core/http/auth.middleware.js", () => ({
    requireAuth: (req, res, next) => {
      const userId = String(req.headers["x-test-user-id"] || "").trim();
      const role = String(req.headers["x-test-role"] || "").trim();
      if (!userId) {
        return res.status(401).json({ error: "unauthorized" });
      }
      req.user = { id: userId, role: role || "buyer" };
      return next();
    },
  }));

  const paymentsRouter = require(PAYMENTS_ROUTE_MODULE_PATH);
  const app = express();
  app.use(express.json());
  app.use("/api/payments", paymentsRouter);

  const restoreEnv = () => {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.ENABLE_MOCK_PAYMENT_MUTATIONS;
    else process.env.ENABLE_MOCK_PAYMENT_MUTATIONS = previousGate;
  };

  return { app, state, sendEmailByTemplate, restoreEnv };
};

const withUser = (userId, role) => ({
  "x-test-user-id": userId,
  "x-test-role": role,
});

describe("payments mock confirm trust boundaries", () => {
  let restoreLogs = () => {};

  beforeAll(() => {
    restoreLogs = silenceTestLogs(["log", "warn", "error", "info"]);
  });

  afterAll(() => {
    restoreLogs();
  });

  afterEach(() => {
    jest.resetModules();
  });

  it("allows mock confirm in the explicit test environment path", async () => {
    const harness = createHarness({ nodeEnv: "test", enableMockMutations: false });
    try {
      const response = await request(harness.app)
        .post("/api/payments/mock/confirm/payment-1")
        .set(withUser("buyer-1", "buyer"))
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: "paid", paymentId: "payment-1" });
      expect(harness.state.payments[0].status).toBe("paid");
      expect(harness.state.payment_events).toHaveLength(1);
    } finally {
      harness.restoreEnv();
    }
  });

  it("rejects mock confirm outside test when the explicit env gate is disabled", async () => {
    const harness = createHarness({ nodeEnv: "development", enableMockMutations: false });
    try {
      const response = await request(harness.app)
        .post("/api/payments/mock/confirm/payment-1")
        .set(withUser("admin-1", "admin"))
        .send({});

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "forbidden" });
      expect(harness.state.payments[0].status).toBe("pending");
      expect(harness.state.payment_events).toHaveLength(0);
      expect(harness.state.order_events).toHaveLength(0);
    } finally {
      harness.restoreEnv();
    }
  });

  it("rejects mock confirm outside test when the caller is not an admin", async () => {
    const harness = createHarness({ nodeEnv: "development", enableMockMutations: true });
    try {
      const response = await request(harness.app)
        .post("/api/payments/mock/confirm/payment-1")
        .set(withUser("buyer-1", "buyer"))
        .send({});

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "forbidden" });
      expect(harness.state.payments[0].status).toBe("pending");
      expect(harness.state.payment_events).toHaveLength(0);
      expect(harness.state.order_events).toHaveLength(0);
    } finally {
      harness.restoreEnv();
    }
  });

  it("allows mock confirm outside test only with explicit gate and admin auth", async () => {
    const harness = createHarness({ nodeEnv: "development", enableMockMutations: true });
    try {
      const response = await request(harness.app)
        .post("/api/payments/mock/confirm/payment-1")
        .set(withUser("admin-1", "admin"))
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: "paid", paymentId: "payment-1" });
      expect(harness.state.payments[0].status).toBe("paid");
      expect(harness.state.payment_events).toHaveLength(1);
      expect(harness.state.order_events).toHaveLength(1);
    } finally {
      harness.restoreEnv();
    }
  });
});
