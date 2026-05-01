"use strict";

const path = require("node:path");
const express = require("express");
const request = require("supertest");

const CART_ROUTE_MODULE_PATH = path.resolve(__dirname, "../src/routes/cart.routes.js");

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

const createCartState = () => {
  const buyerId = "00000000-0000-4000-8000-000000000100";
  const productId = "00000000-0000-4000-8000-000000000010";
  const variantId = "00000000-0000-4000-8000-000000000020";
  const inventorySkuId = "00000000-0000-4000-8000-000000000030";

  return {
    users: [{ id: buyerId, role: "buyer" }],
    carts: [],
    cart_items: [],
    products: [{ id: productId, title: "Classic Tee", is_active: true }],
    product_variants: [
      {
        id: variantId,
        product_id: productId,
        inventory_sku_id: inventorySkuId,
        is_listed: true,
        selling_price_cents: 1499,
        price_cents: 1499,
      },
    ],
    inventory_skus: [
      {
        id: inventorySkuId,
        stock: 5,
        is_active: true,
        supplier_sku: "TEE-BLK-M",
        merch_type: "tee",
        quality_tier: "standard",
        size: "M",
        color: "Black",
      },
    ],
    __nowTick: 0,
  };
};

const createMemoryDb = (state) => {
  const nowIso = () => {
    state.__nowTick += 1;
    return new Date(1741392000000 + state.__nowTick * 1000).toISOString();
  };

  const makeQuery = (tableName) => {
    const table = normalizeTableName(tableName);
    const ctx = {
      filters: [],
      orderBy: [],
    };

    const executeRows = () => {
      let rows = (state[table] || []).map((row) => ({ ...row }));
      rows = ctx.filters.reduce((acc, filter) => acc.filter(filter), rows);
      if (ctx.orderBy.length) {
        rows.sort((a, b) => {
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
      }
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
        } else if (String(arg2 || "").trim() === ">=") {
          ctx.filters.push((row) => Number(row[col] || 0) >= Number(arg3));
        } else {
          ctx.filters.push((row) => row[col] === arg3);
        }
        return query;
      },
      andWhere(arg1, arg2, arg3) {
        return query.where(arg1, arg2, arg3);
      },
      orderBy(column, direction = "asc") {
        ctx.orderBy.push({
          column: columnKey(column),
          direction: String(direction).trim().toLowerCase(),
        });
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
          const target = (state[table] || []).find((entry) => entry.id === row.id);
          if (!target) continue;
          Object.assign(target, patch);
          updated += 1;
        }
        return updated;
      },
      async del() {
        const rows = executeRows();
        const ids = new Set(rows.map((row) => row.id));
        const before = (state[table] || []).length;
        state[table] = (state[table] || []).filter((row) => !ids.has(row.id));
        return before - state[table].length;
      },
      delete() {
        return query.del();
      },
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = rows.map((row) => ({
          ...row,
          id: row.id || `${table}-${(state[table] || []).length + 1}`,
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

const createCartApiHarness = () => {
  const state = createCartState();
  const db = createMemoryDb(state);

  jest.resetModules();
  jest.doMock("../src/core/db/db.js", () => ({
    getDb: () => db,
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

  const cartRouter = require(CART_ROUTE_MODULE_PATH);
  const app = express();
  app.use(express.json());
  app.use("/api/cart", cartRouter);
  return { app, state };
};

const withUser = (userId, role = "buyer") => ({
  "x-test-user-id": userId,
  "x-test-role": role,
});

describe("cart routes", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("returns an empty cart for a buyer with no cart yet", async () => {
    const { app, state } = createCartApiHarness();
    const buyerId = state.users[0].id;

    const response = await request(app).get("/api/cart").set(withUser(buyerId));

    expect(response.status).toBe(200);
    expect(response.body?.cart?.items).toEqual([]);
    expect(response.body?.cart?.subtotalCents).toBe(0);
  });

  it("adds items, merges duplicate variants, updates quantity, and clears the cart", async () => {
    const { app, state } = createCartApiHarness();
    const buyerId = state.users[0].id;
    const productId = state.products[0].id;
    const variantId = state.product_variants[0].id;

    const addFirst = await request(app)
      .post("/api/cart/items")
      .set(withUser(buyerId))
      .send({ productId, productVariantId: variantId, quantity: 2 });
    expect(addFirst.status).toBe(200);
    expect(addFirst.body?.cart?.items).toHaveLength(1);
    expect(addFirst.body?.cart?.subtotalCents).toBe(2998);

    const addDuplicate = await request(app)
      .post("/api/cart/items")
      .set(withUser(buyerId))
      .send({ productId, productVariantId: variantId, quantity: 1 });
    expect(addDuplicate.status).toBe(200);
    expect(addDuplicate.body?.cart?.items[0]?.quantity).toBe(3);

    const itemId = addDuplicate.body?.cart?.items[0]?.id;
    expect(itemId).toBeTruthy();

    const patchResponse = await request(app)
      .patch(`/api/cart/items/${itemId}`)
      .set(withUser(buyerId))
      .send({ quantity: 4 });
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body?.cart?.items[0]?.quantity).toBe(4);
    expect(patchResponse.body?.cart?.subtotalCents).toBe(5996);

    const clearResponse = await request(app)
      .delete("/api/cart")
      .set(withUser(buyerId));
    expect(clearResponse.status).toBe(200);
    expect(clearResponse.body?.cart?.items).toEqual([]);
    expect(clearResponse.body?.cart?.subtotalCents).toBe(0);
  });

  it("rejects requests above available stock", async () => {
    const { app, state } = createCartApiHarness();
    const buyerId = state.users[0].id;
    const productId = state.products[0].id;
    const variantId = state.product_variants[0].id;

    const response = await request(app)
      .post("/api/cart/items")
      .set(withUser(buyerId))
      .send({ productId, productVariantId: variantId, quantity: 99 });

    expect(response.status).toBe(409);
    expect(response.body?.error).toBe("out_of_stock");
  });
});
