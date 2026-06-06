"use strict";

const path = require("node:path");
const express = require("express");
const request = require("supertest");

const ADDRESSES_ROUTE_MODULE_PATH = path.resolve(__dirname, "../src/routes/addresses.routes.js");

const normalizeTableName = (tableName) =>
  String(tableName || "")
    .trim()
    .split(/\s+as\s+/i)[0]
    .trim();

const columnKey = (columnName) => String(columnName || "").split(".").pop();

const createAddressState = () => {
  const buyerId = "00000000-0000-4000-8000-000000000111";
  const otherUserId = "00000000-0000-4000-8000-000000000222";
  return {
    users: [
      { id: buyerId, role: "buyer" },
      { id: otherUserId, role: "buyer" },
    ],
    user_addresses: [],
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
            if (typeof left === "boolean" || typeof right === "boolean") {
              const boolResult = (Number(left) - Number(right)) * (rule.direction === "desc" ? -1 : 1);
              if (boolResult !== 0) return boolResult;
              continue;
            }
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
        if (typeof arg1 === "function") {
          const nestedFilters = [];
          const builder = {
            whereNot(payload) {
              for (const [key, value] of Object.entries(payload || {})) {
                const col = columnKey(key);
                nestedFilters.push((row) => row[col] !== value);
              }
              return builder;
            },
          };
          arg1(builder);
          ctx.filters.push((row) => nestedFilters.every((filter) => filter(row)));
          return query;
        }

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
        if (!cols.length) return row;
        const out = {};
        for (const col of cols) out[columnKey(col)] = row[columnKey(col)];
        return out;
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
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        state[table].push(...rows.map((row) => ({ ...row })));
        return {
          returning: async () => rows,
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
  return db;
};

const createAddressesApiHarness = () => {
  const state = createAddressState();
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

  const addressesRouter = require(ADDRESSES_ROUTE_MODULE_PATH);
  const app = express();
  app.use(express.json());
  app.use("/api/addresses", addressesRouter);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: "internal_server_error", message: err.message });
  });
  return { app, state };
};

const withUser = (userId, role = "buyer") => ({
  "x-test-user-id": userId,
  "x-test-role": role,
});

describe("addresses routes", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("creates, updates, lists, and deletes saved addresses for a buyer", async () => {
    const { app, state } = createAddressesApiHarness();
    const buyerId = state.users[0].id;

    const createResponse = await request(app)
      .post("/api/addresses")
      .set(withUser(buyerId))
      .send({
        fullName: "Souvik Das",
        phone: "9876543210",
        line1: "221B Baker Street",
        city: "Kolkata",
        state: "West Bengal",
        postalCode: "700001",
        country: "India",
        addressType: "home",
      });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body?.addresses).toHaveLength(1);
    expect(createResponse.body?.addresses[0]?.isDefault).toBe(true);

    const addressId = createResponse.body?.addresses[0]?.id;
    const updateResponse = await request(app)
      .patch(`/api/addresses/${addressId}`)
      .set(withUser(buyerId))
      .send({
        line2: "Near Metro Station",
        landmark: "Blue Gate",
        addressType: "work",
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body?.addresses[0]?.line2).toBe("Near Metro Station");
    expect(updateResponse.body?.addresses[0]?.addressType).toBe("work");

    const listResponse = await request(app)
      .get("/api/addresses")
      .set(withUser(buyerId));

    expect(listResponse.status).toBe(200);
    expect(listResponse.body?.addresses).toHaveLength(1);

    const deleteResponse = await request(app)
      .delete(`/api/addresses/${addressId}`)
      .set(withUser(buyerId));

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body?.addresses).toEqual([]);
  });

  it("keeps a single default address and reassigns default after deletion", async () => {
    const { app, state } = createAddressesApiHarness();
    const buyerId = state.users[0].id;

    const first = await request(app)
      .post("/api/addresses")
      .set(withUser(buyerId))
      .send({
        fullName: "First User",
        phone: "1111111111",
        line1: "Address One",
        city: "Delhi",
        state: "Delhi",
        postalCode: "110001",
        country: "India",
      });

    const firstId = first.body?.addresses?.[0]?.id;

    const second = await request(app)
      .post("/api/addresses")
      .set(withUser(buyerId))
      .send({
        fullName: "Second User",
        phone: "2222222222",
        line1: "Address Two",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
        isDefault: true,
      });

    expect(second.status).toBe(200);
    expect(second.body?.addresses?.filter((item) => item.isDefault)).toHaveLength(1);
    const defaultId = second.body?.addresses?.find((item) => item.isDefault)?.id;
    expect(defaultId).not.toBe(firstId);

    const deleteDefault = await request(app)
      .delete(`/api/addresses/${defaultId}`)
      .set(withUser(buyerId));

    expect(deleteDefault.status).toBe(200);
    expect(deleteDefault.body?.addresses).toHaveLength(1);
    expect(deleteDefault.body?.addresses?.[0]?.id).toBe(firstId);
    expect(deleteDefault.body?.addresses?.[0]?.isDefault).toBe(true);
  });

  it("rejects invalid payloads and cross-user edits", async () => {
    const { app, state } = createAddressesApiHarness();
    const buyerId = state.users[0].id;
    const otherUserId = state.users[1].id;

    const invalid = await request(app)
      .post("/api/addresses")
      .set(withUser(buyerId))
      .send({
        fullName: "",
        phone: "",
      });

    expect(invalid.status).toBe(400);
    expect(invalid.body?.error).toBe("validation_error");

    const created = await request(app)
      .post("/api/addresses")
      .set(withUser(buyerId))
      .send({
        fullName: "Private User",
        phone: "9999999999",
        line1: "Secret Lane",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411001",
        country: "India",
      });

    const addressId = created.body?.addresses?.[0]?.id;
    const forbiddenEdit = await request(app)
      .patch(`/api/addresses/${addressId}`)
      .set(withUser(otherUserId))
      .send({ city: "Jaipur" });

    expect(forbiddenEdit.status).toBe(404);
    expect(forbiddenEdit.body?.error).toBe("address_not_found");
  });
});
