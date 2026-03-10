const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { silenceTestLogs } = require("./helpers/logging");

const ORDERS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/orders.routes.js"
);
const PAYMENTS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/payments.routes.js"
);
const ADMIN_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/admin.routes.js"
);
const EMAIL_SERVICE_MODULE_ID = "../src/services/email.service.js";

describe("orders lifecycle", () => {
  it("order item payload captures inventory + pricing snapshot fields", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { buildOrderItemInsertPayload } = routeModule.__test;

    const payload = buildOrderItemInsertPayload({
      columns: {
        inventory_sku_id: {},
        supplier_sku: {},
        merch_type: {},
        quality_tier: {},
        size: {},
        color: {},
        selling_price_cents: {},
        vendor_payout_cents: {},
        royalty_cents: {},
        our_share_cents: {},
      },
      orderId: "00000000-0000-4000-8000-000000000001",
      line: {
        productId: "00000000-0000-4000-8000-000000000010",
        productVariantId: "00000000-0000-4000-8000-000000000020",
        quantity: 1,
      },
      variant: {
        inventory_sku_id: "00000000-0000-4000-8000-000000000999",
        supplier_sku: "SUP-001",
        merch_type: "tee",
        quality_tier: "premium",
        size: "M",
        color: "black",
        selling_price_cents: 1999,
        vendor_payout_cents: 750,
        royalty_cents: 250,
        our_share_cents: 999,
      },
      now: new Date().toISOString(),
    });

    expect(payload.inventory_sku_id).toBe("00000000-0000-4000-8000-000000000999");
    expect(payload.supplier_sku).toBe("SUP-001");
    expect(payload.selling_price_cents).toBe(1999);
    expect(payload.vendor_payout_cents).toBe(750);
    expect(payload.royalty_cents).toBe(250);
    expect(payload.our_share_cents).toBe(999);
  });

  it("fails when SKU stock is insufficient", async () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { reserveInventoryForLine } = routeModule.__test;

    const line = {
      productId: "00000000-0000-4000-8000-000000000010",
      productVariantId: "00000000-0000-4000-8000-000000000020",
      quantity: 3,
    };

    await expect(
      reserveInventoryForLine({
        trx: {},
        line,
        now: new Date().toISOString(),
        loadVariant: async () => ({
          inventory_sku_id: "00000000-0000-4000-8000-000000000999",
          product_is_active: true,
          is_listed: true,
          sku_is_active: true,
          stock: 2,
          selling_price_cents: 1500,
        }),
        decrementInventory: async () => {
          throw new Error("should_not_run_when_stock_insufficient");
        },
      })
    ).rejects.toEqual(expect.objectContaining({ code: "OUT_OF_STOCK" }));
  });

  it("reserves stock via inventory_sku_id and not variant stock mutation", async () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { reserveInventoryForLine } = routeModule.__test;

    const line = {
      productId: "00000000-0000-4000-8000-000000000010",
      productVariantId: "00000000-0000-4000-8000-000000000020",
      quantity: 2,
    };
    let receivedArgs = null;

    const variant = await reserveInventoryForLine({
      trx: {},
      line,
      now: new Date().toISOString(),
      loadVariant: async () => ({
        inventory_sku_id: "00000000-0000-4000-8000-000000000999",
        product_is_active: true,
        is_listed: true,
        sku_is_active: true,
        stock: 10,
        selling_price_cents: 2100,
      }),
      decrementInventory: async (args) => {
        receivedArgs = args;
        return 1;
      },
    });

    expect(variant).toBeTruthy();
    expect(receivedArgs.inventorySkuId).toBe("00000000-0000-4000-8000-000000000999");
    expect(receivedArgs.quantity).toBe(2);
    expect("productVariantId" in receivedArgs).toBe(false);
  });

  it("checkout economics derives our_share_cents when omitted", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { normalizeVariantEconomicsForCheckout } = routeModule.__test;

    const normalized = normalizeVariantEconomicsForCheckout({
      selling_price_cents: 2100,
      vendor_payout_cents: 700,
      royalty_cents: 300,
      our_share_cents: null,
    });

    expect(normalized.error).toBe(null);
    expect(normalized.value.our_share_cents).toBe(1100);
  });

  it("throws out_of_stock when inventory decrement race loses", async () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { reserveInventoryForLine } = routeModule.__test;

    const line = {
      productId: "00000000-0000-4000-8000-000000000010",
      productVariantId: "00000000-0000-4000-8000-000000000020",
      quantity: 1,
    };

    await expect(
      reserveInventoryForLine({
        trx: {},
        line,
        now: new Date().toISOString(),
        loadVariant: async () => ({
          inventory_sku_id: "00000000-0000-4000-8000-000000000999",
          product_is_active: true,
          is_listed: true,
          sku_is_active: true,
          stock: 5,
          selling_price_cents: 999,
        }),
        decrementInventory: async () => 0,
      })
    ).rejects.toEqual(expect.objectContaining({ code: "OUT_OF_STOCK" }));
  });
});

const PAYMENT_SERVICE_MODULE_ID = "../src/core/payments/paymentService.js";

const normalizeTableName = (tableName) =>
  String(tableName || "")
    .trim()
    .split(/\s+as\s+/i)[0]
    .trim();

const columnKey = (columnName) => String(columnName || "").split(".").pop();

const parseAlias = (spec, fallback = "count") => {
  if (!spec) return fallback;
  if (typeof spec === "string") {
    const match = spec.match(/\bas\s+([a-z0-9_]+)$/i);
    return match?.[1] || columnKey(spec);
  }
  if (typeof spec === "object") {
    const values = Object.values(spec);
    if (values.length > 0) return String(values[0]);
  }
  return fallback;
};

const pickColumns = (row, cols) => {
  if (!Array.isArray(cols) || cols.length === 0) return { ...row };
  const out = {};
  for (const col of cols) {
    const key = columnKey(col);
    out[key] = row[key];
  }
  return out;
};

const createOrdersState = () => {
  const productId = "00000000-0000-4000-8000-000000000010";
  const variantId = "00000000-0000-4000-8000-000000000020";
  const inventorySkuId = "00000000-0000-4000-8000-000000000030";
  return {
    users: [
      {
        id: "00000000-0000-4000-8000-000000000100",
        role: "buyer",
        email: "buyer@example.com",
      },
      {
        id: "00000000-0000-4000-8000-000000000200",
        role: "admin",
        email: "admin@example.com",
      },
    ],
    products: [{ id: productId, artist_id: "artist-1", is_active: true }],
    product_variants: [
      {
        id: variantId,
        product_id: productId,
        inventory_sku_id: inventorySkuId,
        is_listed: true,
        selling_price_cents: 1999,
        vendor_payout_cents: 700,
        royalty_cents: 300,
        our_share_cents: 999,
      },
    ],
    inventory_skus: [
      {
        id: inventorySkuId,
        stock: 5,
        is_active: true,
        supplier_sku: "SUP-001",
        merch_type: "tee",
        quality_tier: "standard",
        size: "M",
        color: "Black",
      },
    ],
    orders: [],
    order_items: [],
    order_events: [],
    payments: [],
    payment_events: [],
    payment_attempts: [],
    __nowTick: 0,
  };
};

const createMemoryDb = (state) => {
  const nowIso = () => {
    state.__nowTick += 1;
    return new Date(1741392000000 + state.__nowTick * 1000).toISOString();
  };

  const materializeRows = (tableName, ctx) => {
    const normalized = normalizeTableName(tableName);
    if (normalized === "product_variants") {
      const variants = state.product_variants.map((variant) => {
        const product = state.products.find((row) => row.id === variant.product_id) || {};
        const sku =
          state.inventory_skus.find((row) => row.id === variant.inventory_sku_id) || {};
        return {
          ...variant,
          product_is_active: product.is_active,
          supplier_sku: sku.supplier_sku || null,
          merch_type: sku.merch_type || null,
          quality_tier: sku.quality_tier || null,
          size: sku.size || null,
          color: sku.color || null,
          stock: Number(sku.stock ?? 0),
          sku_is_active: Boolean(sku.is_active),
          selling_price_cents:
            variant.selling_price_cents == null ? variant.price_cents : variant.selling_price_cents,
        };
      });
      return variants;
    }
    return Array.isArray(state[normalized]) ? state[normalized] : [];
  };

  const makeQuery = (tableName) => {
    const ctx = {
      filters: [],
      groupBy: [],
      orderBy: [],
      limit: null,
      offset: 0,
      countSpec: null,
      countDistinctSpec: null,
      sumSpec: null,
    };
    const table = normalizeTableName(tableName);

    const applyFilters = (rows) => ctx.filters.reduce((acc, fn) => acc.filter(fn), rows);
    const applyOrder = (rows) => {
      if (!ctx.orderBy.length) return rows;
      const copy = rows.slice();
      copy.sort((a, b) => {
        for (const rule of ctx.orderBy) {
          const left = a[rule.column];
          const right = b[rule.column];
          if (left === right) continue;
          if (left == null) return 1;
          if (right == null) return -1;
          const result =
            String(left).localeCompare(String(right), undefined, { numeric: true }) *
            (rule.direction === "desc" ? -1 : 1);
          if (result !== 0) return result;
        }
        return 0;
      });
      return copy;
    };

    const aggregateRows = (rows) => {
      if (ctx.countSpec) {
        const alias = parseAlias(ctx.countSpec, "count");
        if (ctx.groupBy.length > 0) {
          const buckets = new Map();
          for (const row of rows) {
            const key = ctx.groupBy.map((name) => row[columnKey(name)]).join("::");
            if (!buckets.has(key)) {
              const seed = {};
              for (const name of ctx.groupBy) {
                seed[columnKey(name)] = row[columnKey(name)];
              }
              seed[alias] = 0;
              buckets.set(key, seed);
            }
            buckets.get(key)[alias] += 1;
          }
          return Array.from(buckets.values());
        }
        return [{ [alias]: rows.length }];
      }

      if (ctx.countDistinctSpec) {
        const alias = parseAlias(ctx.countDistinctSpec, "count");
        const targetColumn = columnKey(
          typeof ctx.countDistinctSpec === "string"
            ? ctx.countDistinctSpec.replace(/\bas\s+[a-z0-9_]+$/i, "")
            : "id"
        );
        const distinct = new Set(rows.map((row) => row[targetColumn]));
        return [{ [alias]: distinct.size }];
      }

      if (ctx.sumSpec) {
        const alias =
          typeof ctx.sumSpec === "string"
            ? parseAlias(ctx.sumSpec, "sum")
            : parseAlias(ctx.sumSpec, "sum");
        if (typeof ctx.sumSpec === "object" && table === "order_items") {
          const expression = Object.keys(ctx.sumSpec)[0];
          if (String(expression).includes("price_cents")) {
            const total = rows.reduce(
              (acc, row) => acc + Number(row.price_cents || 0) * Number(row.quantity || 0),
              0
            );
            return [{ [alias]: total }];
          }
        }
        const targetColumn =
          typeof ctx.sumSpec === "string"
            ? columnKey(ctx.sumSpec.replace(/\bas\s+[a-z0-9_]+$/i, ""))
            : columnKey(Object.keys(ctx.sumSpec)[0]);
        const total = rows.reduce((acc, row) => acc + Number(row[targetColumn] || 0), 0);
        return [{ [alias]: total }];
      }
      return rows;
    };

    const executeRows = () => {
      const baseRows = materializeRows(tableName, ctx).map((row) => ({ ...row }));
      let rows = applyFilters(baseRows);
      rows = aggregateRows(rows);
      rows = applyOrder(rows);
      if (ctx.offset) rows = rows.slice(ctx.offset);
      if (ctx.limit != null) rows = rows.slice(0, ctx.limit);
      return rows;
    };

    const query = {
      where(arg1, arg2, arg3) {
        if (arg1 && typeof arg1 === "object" && arg2 === undefined) {
          for (const [key, value] of Object.entries(arg1)) {
            const col = columnKey(key);
            ctx.filters.push((row) => row[col] === value);
          }
          return query;
        }
        const col = columnKey(arg1);
        if (arg3 === undefined) {
          ctx.filters.push((row) => row[col] === arg2);
        } else {
          const op = String(arg2 || "=").trim();
          const value = arg3;
          if (op === ">=") ctx.filters.push((row) => Number(row[col] || 0) >= Number(value));
          else ctx.filters.push((row) => row[col] === value);
        }
        return query;
      },
      whereNot(arg1, arg2) {
        const col = columnKey(arg1);
        ctx.filters.push((row) => row[col] !== arg2);
        return query;
      },
      andWhere(arg1, arg2, arg3) {
        return query.where(arg1, arg2, arg3);
      },
      whereIn(column, values) {
        const col = columnKey(column);
        const allowed = new Set(Array.isArray(values) ? values : []);
        ctx.filters.push((row) => allowed.has(row[col]));
        return query;
      },
      whereRaw() {
        return query;
      },
      join() {
        return query;
      },
      leftJoin() {
        return query;
      },
      select() {
        return query;
      },
      groupBy(...columns) {
        ctx.groupBy.push(...columns);
        return query;
      },
      count(spec) {
        ctx.countSpec = spec;
        return query;
      },
      countDistinct(spec) {
        ctx.countDistinctSpec = spec;
        return query;
      },
      sum(spec) {
        ctx.sumSpec = spec;
        return query;
      },
      orderBy(column, direction = "asc") {
        ctx.orderBy.push({ column: columnKey(column), direction: String(direction).toLowerCase() });
        return query;
      },
      orderByRaw() {
        return query;
      },
      limit(value) {
        ctx.limit = Number(value);
        return query;
      },
      offset(value) {
        ctx.offset = Number(value);
        return query;
      },
      clone() {
        return query;
      },
      clearSelect() {
        return query;
      },
      clearOrder() {
        return query;
      },
      forUpdate() {
        return query;
      },
      async pluck(column) {
        return executeRows().map((row) => row[columnKey(column)]);
      },
      async columnInfo() {
        if (table === "order_items") {
          return {
            id: {},
            order_id: {},
            product_id: {},
            product_variant_id: {},
            quantity: {},
            price_cents: {},
            inventory_sku_id: {},
            supplier_sku: {},
            merch_type: {},
            quality_tier: {},
            size: {},
            color: {},
            selling_price_cents: {},
            vendor_payout_cents: {},
            royalty_cents: {},
            our_share_cents: {},
            created_at: {},
          };
        }
        return {};
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
          for (const [key, value] of Object.entries(patch || {})) {
            if (value && typeof value === "object" && value.__raw) {
              if (String(value.sql).includes("stock - ?")) {
                target[key] = Number(target[key] || 0) - Number(value.bindings?.[0] || 0);
              } else if (String(value.sql).includes("stock + ?")) {
                target[key] = Number(target[key] || 0) + Number(value.bindings?.[0] || 0);
              } else {
                target[key] = value;
              }
            } else {
              target[key] = value;
            }
          }
          updated += 1;
        }
        return updated;
      },
      async del() {
        const rows = executeRows();
        const ids = new Set(rows.map((row) => row.id));
        const before = state[table].length;
        state[table] = state[table].filter((row) => !ids.has(row.id));
        return before - state[table].length;
      },
      delete() {
        return query.del();
      },
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = rows.map((row) => ({ ...row, id: row.id || `${table}-${state[table].length + 1}` }));
        state[table].push(...inserted);
        return {
          returning: async (cols) => inserted.map((row) => pickColumns(row, cols)),
          onConflict: () => ({
            ignore: async () => undefined,
            merge: async () => undefined,
          }),
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
  db.raw = (sql, bindings) => ({ __raw: true, sql, bindings });
  db.schema = {
    hasTable: async () => true,
  };
  db.transaction = async (handler) => handler(db);
  return db;
};

const createOrdersApiHarness = ({ emailShouldFail = false } = {}) => {
  const state = createOrdersState();
  const db = createMemoryDb(state);
  const sendEmailByTemplate = jest.fn();
  if (emailShouldFail) {
    sendEmailByTemplate.mockRejectedValue(new Error("email_send_failed"));
  } else {
    sendEmailByTemplate.mockResolvedValue({
      attempted: true,
      delivered: true,
      queued: true,
      skipped: false,
    });
  }

  jest.resetModules();
  jest.doMock("../src/core/db/db.js", () => ({
    getDb: () => db,
  }));
  jest.doMock(EMAIL_SERVICE_MODULE_ID, () => ({
    sendEmailByTemplate,
  }));
  jest.doMock("../src/core/http/auth.middleware", () => ({
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
  jest.doMock("../src/core/http/rateLimit", () => () => (req, res, next) => next());
  jest.doMock("../src/core/http/spamDetection", () => ({
    orderSpamGuard: (req, res, next) => next(),
  }));
  jest.doMock(PAYMENT_SERVICE_MODULE_ID, () => {
    const actual = jest.requireActual(PAYMENT_SERVICE_MODULE_ID);
    return {
      ...actual,
      startPaymentForOrder: async ({ orderId, buyerUserId }) => {
        const order = state.orders.find((row) => row.id === orderId);
        if (!order || order.buyer_user_id !== buyerUserId) {
          const err = new Error("order_not_found");
          err.code = "ORDER_NOT_FOUND";
          throw err;
        }
        if (order.status !== "placed") {
          const err = new Error("order_not_payable");
          err.code = "ORDER_NOT_PAYABLE";
          throw err;
        }
        let payment = state.payments.find((row) => row.order_id === orderId);
        if (!payment) {
          payment = {
            id: `${orderId}-payment`,
            order_id: orderId,
            status: "pending",
            provider: "mock",
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
          };
          state.payments.push(payment);
        }
        return {
          paymentId: payment.id,
          status: payment.status,
          provider: payment.provider,
          attemptId: payment.id,
        };
      },
    };
  });

  const ordersRouter = require(ORDERS_ROUTE_MODULE_PATH);
  const paymentsRouter = require(PAYMENTS_ROUTE_MODULE_PATH);
  const adminRouter = require(ADMIN_ROUTE_MODULE_PATH);
  const app = express();
  app.use(express.json());
  app.use("/api/orders", ordersRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/admin", adminRouter);
  return { app, state, sendEmailByTemplate };
};

const withUser = (userId, role) => ({
  "x-test-user-id": userId,
  "x-test-role": role,
});

const collectTemplateCalls = (sendEmailByTemplate, templateKey) =>
  sendEmailByTemplate.mock.calls
    .map((entry) => entry?.[0])
    .filter((payload) => payload?.templateKey === templateKey);

describe("orders lifecycle api flows", () => {
  let restoreLogs = () => {};

  beforeAll(() => {
    restoreLogs = silenceTestLogs(["log", "warn"]);
  });

  afterAll(() => {
    restoreLogs();
  });

  afterEach(() => {
    jest.resetModules();
  });

  it("creates, lists, reads, cancels and tracks buyer order events", async () => {
    const { app, state, sendEmailByTemplate } = createOrdersApiHarness();
    const productId = state.products[0].id;
    const variantId = state.product_variants[0].id;
    const buyerId = state.users.find((user) => user.role === "buyer").id;

    const createRes = await request(app)
      .post("/api/orders")
      .set(withUser(buyerId, "buyer"))
      .send({ productId, productVariantId: variantId, quantity: 1 });
    expect(createRes.status).toBe(200);
    const orderId = createRes.body?.order?.id;
    expect(orderId).toBeTruthy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendEmailByTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "order-confirmation",
        to: "buyer@example.com",
      })
    );

    const listRes = await request(app)
      .get("/api/orders/my")
      .set(withUser(buyerId, "buyer"));
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body?.items)).toBe(true);
    expect(listRes.body.items.some((item) => item.id === orderId)).toBe(true);

    const detailRes = await request(app)
      .get(`/api/orders/${orderId}`)
      .set(withUser(buyerId, "buyer"));
    expect(detailRes.status).toBe(200);
    expect(Array.isArray(detailRes.body?.items)).toBe(true);
    expect(detailRes.body.items.some((item) => item.productVariantId === variantId)).toBe(true);

    const cancelRes = await request(app)
      .post(`/api/orders/${orderId}/cancel`)
      .set(withUser(buyerId, "buyer"));
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe("cancelled");
    await new Promise((resolve) => setImmediate(resolve));
    const cancelledCalls = collectTemplateCalls(sendEmailByTemplate, "order-status-update").filter(
      (payload) => payload?.payload?.status === "cancelled"
    );
    expect(cancelledCalls.length).toBe(1);

    const cancelAgainRes = await request(app)
      .post(`/api/orders/${orderId}/cancel`)
      .set(withUser(buyerId, "buyer"));
    expect(cancelAgainRes.status).toBe(400);
    expect(
      ["order_already_cancelled", "order_not_cancellable"].includes(cancelAgainRes.body?.error)
    ).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    const cancelledCallsAfterRetry = collectTemplateCalls(
      sendEmailByTemplate,
      "order-status-update"
    ).filter((payload) => payload?.payload?.status === "cancelled");
    expect(cancelledCallsAfterRetry.length).toBe(1);

    const eventsRes = await request(app)
      .get(`/api/orders/${orderId}/events`)
      .set(withUser(buyerId, "buyer"));
    expect(eventsRes.status).toBe(200);
    expect(Array.isArray(eventsRes.body?.items)).toBe(true);
    expect(eventsRes.body.items.some((event) => event.type === "placed")).toBe(true);
    expect(eventsRes.body.items.some((event) => event.type === "cancelled")).toBe(true);

    const artistUserId = "00000000-0000-4000-8000-000000009999";
    const artistCreateRes = await request(app)
      .post("/api/orders")
      .set(withUser(artistUserId, "artist"))
      .send({ productId, productVariantId: variantId, quantity: 1 });
    expect(artistCreateRes.status).toBe(200);
    const artistOrderId = artistCreateRes.body?.order?.id;
    expect(artistOrderId).toBeTruthy();

    const artistOrdersRes = await request(app)
      .get("/api/orders/my")
      .set(withUser(artistUserId, "artist"));
    expect(artistOrdersRes.status).toBe(200);
    expect(Array.isArray(artistOrdersRes.body?.items)).toBe(true);
    expect(artistOrdersRes.body.items.some((item) => item.id === artistOrderId)).toBe(true);

    const labelOrdersRes = await request(app)
      .get("/api/orders/my")
      .set(withUser("00000000-0000-4000-8000-000000008888", "label"));
    expect(labelOrdersRes.status).toBe(200);

    const adminOrdersRes = await request(app)
      .get("/api/orders/my")
      .set(withUser("00000000-0000-4000-8000-000000007777", "admin"));
    expect(adminOrdersRes.status).toBe(200);
  });

  it("supports pay/confirm idempotency, fulfill/refund, and key forbidden transitions", async () => {
    const { app, state, sendEmailByTemplate } = createOrdersApiHarness();
    const productId = state.products[0].id;
    const variantId = state.product_variants[0].id;
    const buyerId = state.users.find((user) => user.role === "buyer").id;
    const adminId = state.users.find((user) => user.role === "admin").id;

    const createPaidRes = await request(app)
      .post("/api/orders")
      .set(withUser(buyerId, "buyer"))
      .send({ productId, productVariantId: variantId, quantity: 1 });
    expect(createPaidRes.status).toBe(200);
    const paidOrderId = createPaidRes.body?.order?.id;
    expect(paidOrderId).toBeTruthy();

    const payRes = await request(app)
      .post(`/api/orders/${paidOrderId}/pay`)
      .set(withUser(buyerId, "buyer"))
      .send({});
    expect(payRes.status).toBe(200);
    const paymentId = payRes.body?.paymentId;
    const confirmPath = payRes.body?.confirmPath;
    expect(paymentId).toBeTruthy();
    expect(confirmPath).toBe(`/api/payments/mock/confirm/${paymentId}`);

    const confirmFirstRes = await request(app).post(confirmPath).send({});
    expect(confirmFirstRes.status).toBe(200);
    expect(confirmFirstRes.body?.status).toBe("paid");
    await new Promise((resolve) => setImmediate(resolve));

    const confirmSecondRes = await request(app).post(confirmPath).send({});
    expect(confirmSecondRes.status).toBe(200);
    expect(confirmSecondRes.body?.idempotent).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));

    const paidDetailRes = await request(app)
      .get(`/api/orders/${paidOrderId}`)
      .set(withUser(buyerId, "buyer"));
    expect(paidDetailRes.status).toBe(200);
    expect(paidDetailRes.body?.payment?.status).toBe("paid");

    const adminListRes = await request(app)
      .get("/api/admin/orders")
      .set(withUser(adminId, "admin"));
    expect(adminListRes.status).toBe(200);
    expect(Array.isArray(adminListRes.body?.items)).toBe(true);
    expect(typeof adminListRes.body?.total).toBe("number");
    expect(adminListRes.body?.page).toEqual(expect.any(Object));

    const adminDetailRes = await request(app)
      .get(`/api/admin/orders/${paidOrderId}`)
      .set(withUser(adminId, "admin"));
    expect(adminDetailRes.status).toBe(200);
    expect(adminDetailRes.body?.id || adminDetailRes.body?.orderId).toBe(paidOrderId);
    expect(Array.isArray(adminDetailRes.body?.items)).toBe(true);

    const fulfillRes = await request(app)
      .post(`/api/admin/orders/${paidOrderId}/fulfill`)
      .set(withUser(adminId, "admin"))
      .send({});
    expect(fulfillRes.status).toBe(200);
    expect(fulfillRes.body?.status).toBe("fulfilled");
    await new Promise((resolve) => setImmediate(resolve));

    const refundRes = await request(app)
      .post(`/api/admin/orders/${paidOrderId}/refund`)
      .set(withUser(adminId, "admin"))
      .send({});
    expect(refundRes.status).toBe(200);
    expect(refundRes.body?.status).toBe("refunded");
    await new Promise((resolve) => setImmediate(resolve));

    const paidStatusCalls = collectTemplateCalls(sendEmailByTemplate, "order-status-update").filter(
      (payload) => payload?.payload?.status === "paid" && payload?.payload?.orderId === paidOrderId
    );
    expect(paidStatusCalls.length).toBe(1);
    const refundedStatusCalls = collectTemplateCalls(
      sendEmailByTemplate,
      "order-status-update"
    ).filter(
      (payload) => payload?.payload?.status === "refunded" && payload?.payload?.orderId === paidOrderId
    );
    expect(refundedStatusCalls.length).toBe(1);
    const dispatchedCalls = collectTemplateCalls(sendEmailByTemplate, "shipment-dispatched").filter(
      (payload) => payload?.payload?.orderId === paidOrderId
    );
    expect(dispatchedCalls.length).toBe(1);

    const adminEventsRes = await request(app)
      .get(`/api/admin/orders/${paidOrderId}/events`)
      .set(withUser(adminId, "admin"));
    expect(adminEventsRes.status).toBe(200);
    const eventTypes = new Set((adminEventsRes.body?.items || []).map((event) => event.type));
    expect(eventTypes.has("paid")).toBe(true);
    expect(eventTypes.has("fulfilled")).toBe(true);
    expect(eventTypes.has("refunded")).toBe(true);

    const cancelFulfilledRes = await request(app)
      .post(`/api/orders/${paidOrderId}/cancel`)
      .set(withUser(buyerId, "buyer"))
      .send({});
    expect(cancelFulfilledRes.status).toBe(400);
    expect(cancelFulfilledRes.body?.error).toBe("order_not_cancellable");

    const createUnpaidRes = await request(app)
      .post("/api/orders")
      .set(withUser(buyerId, "buyer"))
      .send({ productId, productVariantId: variantId, quantity: 1 });
    expect(createUnpaidRes.status).toBe(200);
    const unpaidOrderId = createUnpaidRes.body?.order?.id;
    expect(unpaidOrderId).toBeTruthy();

    const unpaidFulfillRes = await request(app)
      .post(`/api/admin/orders/${unpaidOrderId}/fulfill`)
      .set(withUser(adminId, "admin"))
      .send({});
    expect(unpaidFulfillRes.status).toBe(400);
    expect(unpaidFulfillRes.body?.error).toBe("order_not_paid");
  });

  it("keeps order transitions successful when email sending fails", async () => {
    const { app, state } = createOrdersApiHarness({ emailShouldFail: true });
    const productId = state.products[0].id;
    const variantId = state.product_variants[0].id;
    const buyerId = state.users.find((user) => user.role === "buyer").id;
    const adminId = state.users.find((user) => user.role === "admin").id;

    const createRes = await request(app)
      .post("/api/orders")
      .set(withUser(buyerId, "buyer"))
      .send({ productId, productVariantId: variantId, quantity: 1 });
    expect(createRes.status).toBe(200);
    const orderId = createRes.body?.order?.id;
    expect(orderId).toBeTruthy();

    const payRes = await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set(withUser(buyerId, "buyer"))
      .send({});
    expect(payRes.status).toBe(200);
    const confirmPath = payRes.body?.confirmPath;
    expect(confirmPath).toBeTruthy();

    const confirmRes = await request(app).post(confirmPath).send({});
    expect(confirmRes.status).toBe(200);

    const fulfillRes = await request(app)
      .post(`/api/admin/orders/${orderId}/fulfill`)
      .set(withUser(adminId, "admin"))
      .send({});
    expect(fulfillRes.status).toBe(200);

    const cancelRes = await request(app)
      .post(`/api/orders/${orderId}/cancel`)
      .set(withUser(buyerId, "buyer"))
      .send({});
    expect(cancelRes.status).toBe(400);
  });
});

