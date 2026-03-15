process.env.NODE_ENV = "test";
process.env.PAYMENTS_WEBHOOK_SECRET_MOCK =
  process.env.PAYMENTS_WEBHOOK_SECRET_MOCK || "payments-webhook-test-secret";

const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const request = require("supertest");
const { silenceTestLogs } = require("./helpers/logging");

const PAYMENTS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/payments.routes.js"
);
const PAYMENT_SERVICE_MODULE_ID = "../src/core/payments/paymentService.js";
const EMAIL_SERVICE_MODULE_ID = "../src/services/email.service.js";
const EMAIL_SERVICE_MODULE_ID_NO_EXT = "../src/services/email.service";

const createPaymentsState = () => ({
  users: [
    { id: "buyer-1", email: "buyer@example.com" },
  ],
  orders: [
    { id: "order-1", buyer_user_id: "buyer-1" },
  ],
  payments: [
    {
      id: "payment-1",
      order_id: "order-1",
      provider_payment_id: "provider-pay-1",
      provider_order_id: "provider-order-1",
      status: "pending",
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
    const key = columnKey(col);
    out[key] = row[key];
  }
  return out;
};

const createPaymentsDb = (state) => {
  const nowIso = () => {
    state.__nowTick += 1;
    return new Date(1741392000000 + state.__nowTick * 1000).toISOString();
  };

  const makeQuery = (tableName) => {
    const table = normalizeTableName(tableName);
    const ctx = {
      filters: [],
    };

    const executeRows = () => {
      const baseRows = Array.isArray(state[table]) ? state[table].map((row) => ({ ...row })) : [];
      return ctx.filters.reduce((acc, filter) => acc.filter(filter), baseRows);
    };

    const query = {
      where(arg1, arg2) {
        if (arg1 && typeof arg1 === "object" && arg2 === undefined) {
          for (const [key, value] of Object.entries(arg1)) {
            const col = columnKey(key);
            ctx.filters.push((row) => row[col] === value);
          }
          return query;
        }
        const col = columnKey(arg1);
        ctx.filters.push((row) => row[col] === arg2);
        return query;
      },
      async first(...cols) {
        const row = executeRows()[0] || null;
        if (!row) return null;
        return pickColumns(row, cols);
      },
      async update(patch) {
        const rows = executeRows();
        let updated = 0;
        for (const row of rows) {
          const target = state[table].find((entry) => entry.id === row.id) || row;
          Object.assign(target, patch || {});
          updated += 1;
        }
        return updated;
      },
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = rows.map((row, index) => ({
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
          resolve(executeRows());
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

const buildSignedWebhookRequest = (body, secret) => {
  const rawBody = Buffer.from(JSON.stringify(body));
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return {
    rawBody,
    signature: `sha256=${digest}`,
  };
};

const createWebhookHarness = () => {
  const state = createPaymentsState();
  const db = createPaymentsDb(state);
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
    requireAuth: (_req, _res, next) => next(),
  }));
  jest.doMock(PAYMENT_SERVICE_MODULE_ID, () => jest.requireActual(PAYMENT_SERVICE_MODULE_ID));

  const paymentsRouter = require(PAYMENTS_ROUTE_MODULE_PATH);
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        if (req.originalUrl?.startsWith("/api/payments/webhook/")) {
          req.rawBody = Buffer.from(buf);
        }
      },
    })
  );
  app.use("/api/payments", paymentsRouter);
  app.use((err, _req, res, _next) => {
    const status = err?.type === "entity.parse.failed" ? 400 : 500;
    return res.status(status).json({ error: "internal_server_error" });
  });

  return { app, state, sendEmailByTemplate };
};

describe("payments webhook trust boundaries", () => {
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

  it("rejects missing signature header before any mutation", async () => {
    const { app, state, sendEmailByTemplate } = createWebhookHarness();
    const response = await request(app)
      .post("/api/payments/webhook/mock")
      .send({ id: "evt-missing", payment_id: "provider-pay-1", status: "paid" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "invalid_webhook_signature" });
    expect(state.payments[0].status).toBe("pending");
    expect(state.payment_events).toHaveLength(0);
  });

  it("rejects webhook mutations when the provider secret is not configured", async () => {
    const originalSecret = process.env.PAYMENTS_WEBHOOK_SECRET_MOCK;
    delete process.env.PAYMENTS_WEBHOOK_SECRET_MOCK;
    const { app, state, sendEmailByTemplate } = createWebhookHarness();
    try {
      const body = { id: "evt-no-secret", payment_id: "provider-pay-1", status: "paid" };
      const response = await request(app)
        .post("/api/payments/webhook/mock")
        .set("x-webhook-signature", "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        .send(body);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "invalid_webhook_signature" });
      expect(state.payments[0].status).toBe("pending");
      expect(state.payment_events).toHaveLength(0);
    } finally {
      process.env.PAYMENTS_WEBHOOK_SECRET_MOCK = originalSecret;
    }
  });

  it("rejects malformed and invalid signatures without leaking verification internals", async () => {
    const { app, state } = createWebhookHarness();

    const malformedResponse = await request(app)
      .post("/api/payments/webhook/mock")
      .set("x-webhook-signature", "not-a-signature")
      .send({ id: "evt-malformed", payment_id: "provider-pay-1", status: "paid" });
    expect(malformedResponse.status).toBe(401);
    expect(malformedResponse.body).toEqual({ error: "invalid_webhook_signature" });

    const invalidBody = { id: "evt-invalid", payment_id: "provider-pay-1", status: "paid" };
    const { signature } = buildSignedWebhookRequest(
      { ...invalidBody, status: "failed" },
      process.env.PAYMENTS_WEBHOOK_SECRET_MOCK
    );
    const invalidResponse = await request(app)
      .post("/api/payments/webhook/mock")
      .set("x-webhook-signature", signature)
      .send(invalidBody);

    expect(invalidResponse.status).toBe(401);
    expect(invalidResponse.body).toEqual({ error: "invalid_webhook_signature" });
    expect(state.payments[0].status).toBe("pending");
    expect(state.payment_events).toHaveLength(0);
  });

  it("rejects altered bodies signed with stale signatures", async () => {
    const { app, state } = createWebhookHarness();
    const originalBody = {
      id: "evt-stale",
      payment_id: "provider-pay-1",
      status: "paid",
    };
    const { signature } = buildSignedWebhookRequest(
      originalBody,
      process.env.PAYMENTS_WEBHOOK_SECRET_MOCK
    );

    const response = await request(app)
      .post("/api/payments/webhook/mock")
      .set("x-webhook-signature", signature)
      .send({ ...originalBody, payment_id: "provider-pay-2" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "invalid_webhook_signature" });
    expect(state.payments[0].status).toBe("pending");
    expect(state.payment_events).toHaveLength(0);
  });

  it("fails safely for unsupported events without payment side effects", async () => {
    const { app, state, sendEmailByTemplate } = createWebhookHarness();
    const body = {
      id: "evt-processing",
      payment_id: "provider-pay-1",
      status: "processing",
      currency: "INR",
    };
    const { signature } = buildSignedWebhookRequest(
      body,
      process.env.PAYMENTS_WEBHOOK_SECRET_MOCK
    );

    const response = await request(app)
      .post("/api/payments/webhook/mock")
      .set("x-webhook-signature", signature)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, action: "none", paymentId: "payment-1" });
    expect(state.payments[0].status).toBe("pending");
    expect(state.payment_events).toHaveLength(1);
    expect(state.payment_events[0]).toMatchObject({
      provider: "mock",
      event_type: "webhook_received",
      provider_event_id: "evt-processing",
      payment_id: "payment-1",
    });
    expect(sendEmailByTemplate).not.toHaveBeenCalled();
  });

  it("accepts valid signed requests and applies the webhook mutation once verified", async () => {
    const { app, state, sendEmailByTemplate } = createWebhookHarness();
    const body = {
      id: "evt-paid",
      payment_id: "provider-pay-1",
      status: "paid",
      currency: "INR",
    };
    const { signature } = buildSignedWebhookRequest(
      body,
      process.env.PAYMENTS_WEBHOOK_SECRET_MOCK
    );

    const response = await request(app)
      .post("/api/payments/webhook/mock")
      .set("x-webhook-signature", signature)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      deduped: false,
      action: "mark_paid",
      paymentId: "payment-1",
    });
    expect(state.payments[0].status).toBe("paid");
    expect(state.payment_events).toHaveLength(2);
    expect(state.payment_events[1]).toMatchObject({
      provider: "mock",
      event_type: "payment_paid",
      payment_id: "payment-1",
      provider_event_id: "evt-paid",
    });
  });
});
