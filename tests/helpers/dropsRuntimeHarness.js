"use strict";

const path = require("node:path");
const express = require("express");

const DROPS_ROUTE_MODULE_PATH = path.resolve(__dirname, "../../src/routes/drops.routes.js");
const DB_MODULE_PATH = path.resolve(__dirname, "../../src/core/db/db.js");
const AUTH_MIDDLEWARE_MODULE_PATH = path.resolve(
  __dirname,
  "../../src/core/http/auth.middleware.js"
);
const POLICY_MIDDLEWARE_MODULE_PATH = path.resolve(
  __dirname,
  "../../src/core/http/policy.middleware.js"
);
const OWNERSHIP_MODULE_PATH = path.resolve(__dirname, "../../src/utils/ownership.js");

const normalizeKey = (key) => String(key || "").split(".").pop();

const createDropsState = () => ({
  artists: [
    {
      id: "00000000-0000-4000-8000-000000000201",
      name: "Drop Artist",
      created_at: "2026-03-08T00:00:00.000Z",
    },
  ],
  products: [
    {
      id: "00000000-0000-4000-8000-000000000301",
      title: "Drop Product",
      artist_id: "00000000-0000-4000-8000-000000000201",
    },
  ],
  artistUserMap: [
    {
      artist_id: "00000000-0000-4000-8000-000000000201",
      user_id: "artist-user",
    },
  ],
  drops: [],
  dropProducts: [],
});

const createDropsDb = (state) => {
  const nowIso = "2026-03-08T00:00:00.000Z";

  const getRows = (tableName) => {
    if (tableName === "artists") return state.artists;
    if (tableName === "products") return state.products;
    if (tableName === "artist_user_map") return state.artistUserMap;
    if (tableName === "drops") return state.drops;
    if (tableName === "drop_products") return state.dropProducts;
    return [];
  };

  const makeQuery = (rawTableName) => {
    const tableName = String(rawTableName || "").split(/\s+as\s+/i)[0].trim();
    const ctx = {
      whereObj: {},
      whereRules: [],
      whereNotRules: [],
      whereInRules: [],
      order: [],
      limit: null,
      offset: 0,
      countSpec: null,
    };

    const applyWhere = (rows) =>
      rows.filter((row) => {
        const matchesObject = Object.entries(ctx.whereObj).every(([key, value]) => {
          const normalized = normalizeKey(key);
          return row[normalized] === value;
        });
        if (!matchesObject) return false;
        const matchesRules = ctx.whereRules.every((rule) => {
          const value = row[normalizeKey(rule.column)];
          if (rule.op === "=") return value === rule.value;
          return false;
        });
        if (!matchesRules) return false;
        const matchesWhereIn = ctx.whereInRules.every((rule) => {
          const value = row[normalizeKey(rule.column)];
          return rule.values.includes(value);
        });
        if (!matchesWhereIn) return false;
        return ctx.whereNotRules.every((rule) => {
          const value = row[normalizeKey(rule.column)];
          return value !== rule.value;
        });
      });

    const applySort = (rows) => {
      if (!ctx.order.length) return rows;
      return rows.slice().sort((a, b) => {
        for (const order of ctx.order) {
          const key = normalizeKey(order.column);
          const left = a[key];
          const right = b[key];
          if (left === right) continue;
          const factor = order.direction === "asc" ? 1 : -1;
          return left > right ? factor : -factor;
        }
        return 0;
      });
    };

    const execute = () => {
      let rows = getRows(tableName).slice();
      rows = applyWhere(rows);
      if (ctx.countSpec) {
        let alias = "count";
        if (typeof ctx.countSpec === "object" && ctx.countSpec) {
          alias = Object.keys(ctx.countSpec)[0] || "count";
        } else if (typeof ctx.countSpec === "string") {
          const asMatch = ctx.countSpec.match(/\s+as\s+([a-z0-9_]+)/i);
          alias = asMatch?.[1] || "count";
        }
        return [{ [alias]: rows.length }];
      }
      rows = applySort(rows);
      if (ctx.offset > 0) rows = rows.slice(ctx.offset);
      if (typeof ctx.limit === "number") rows = rows.slice(0, ctx.limit);
      return rows;
    };

    const query = {
      where(arg1, arg2, arg3) {
        if (arg1 && typeof arg1 === "object" && arg2 === undefined) {
          ctx.whereObj = { ...ctx.whereObj, ...(arg1 || {}) };
          return query;
        }
        if (arg3 === undefined) {
          ctx.whereRules.push({ column: arg1, op: "=", value: arg2 });
        } else {
          ctx.whereRules.push({ column: arg1, op: String(arg2 || "="), value: arg3 });
        }
        return query;
      },
      whereNot(column, value) {
        ctx.whereNotRules.push({ column, value });
        return query;
      },
      whereRaw() {
        return query;
      },
      whereIn(column, values) {
        ctx.whereInRules.push({
          column,
          values: Array.isArray(values) ? values.slice() : [],
        });
        return query;
      },
      leftJoin() {
        return query;
      },
      join() {
        return query;
      },
      select() {
        return query;
      },
      groupBy() {
        return query;
      },
      orderBy(column, direction = "asc") {
        ctx.order.push({
          column,
          direction: String(direction || "asc").toLowerCase() === "asc" ? "asc" : "desc",
        });
        return query;
      },
      limit(value) {
        ctx.limit = Number(value);
        return query;
      },
      offset(value) {
        ctx.offset = Number(value) || 0;
        return query;
      },
      count(spec) {
        ctx.countSpec = spec;
        return query;
      },
      async first() {
        return execute()[0] || null;
      },
      async update(patch) {
        const rows = execute();
        let updated = 0;
        const ids = new Set(rows.map((row) => row.id));
        const targetRows = getRows(tableName);
        for (let i = 0; i < targetRows.length; i += 1) {
          if (!ids.has(targetRows[i].id)) continue;
          targetRows[i] = { ...targetRows[i], ...patch };
          updated += 1;
        }
        return updated;
      },
      async del() {
        const rows = execute();
        const keys = new Set(
          rows.map((row) => `${row.drop_id || ""}:${row.product_id || ""}:${row.id || ""}`)
        );
        const targetRows = getRows(tableName);
        const before = targetRows.length;
        const kept = targetRows.filter(
          (row) => !keys.has(`${row.drop_id || ""}:${row.product_id || ""}:${row.id || ""}`)
        );
        targetRows.splice(0, targetRows.length, ...kept);
        return before - kept.length;
      },
      delete() {
        return query.del();
      },
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        if (tableName === "drop_products") {
          return {
            onConflict: () => ({
              merge: async (patch = {}) => {
                for (const row of rows) {
                  const existing = state.dropProducts.find(
                    (entry) =>
                      entry.drop_id === row.drop_id && entry.product_id === row.product_id
                  );
                  if (existing) {
                    Object.assign(existing, patch);
                  } else {
                    state.dropProducts.push({ ...row });
                  }
                }
                return rows.length;
              },
              ignore: async () => {
                for (const row of rows) {
                  const exists = state.dropProducts.some(
                    (entry) =>
                      entry.drop_id === row.drop_id && entry.product_id === row.product_id
                  );
                  if (!exists) {
                    state.dropProducts.push({ ...row });
                  }
                }
                return rows.length;
              },
            }),
          };
        }

        const targetRows = getRows(tableName);
        for (const row of rows) {
          targetRows.push({ ...row });
        }
        return rows.length;
      },
      then(resolve, reject) {
        try {
          resolve(execute());
        } catch (error) {
          if (reject) reject(error);
          else throw error;
        }
      },
    };
    return query;
  };

  const db = (tableName) => makeQuery(tableName);
  db.fn = { now: () => nowIso };
  db.raw = () => null;
  db.schema = {
    hasTable: async (tableName) =>
      !["entity_media_links", "media_assets"].includes(String(tableName || "")),
  };
  db.transaction = async (handler) => {
    const trx = (tableName) => makeQuery(tableName);
    trx.fn = { now: () => nowIso };
    trx.raw = () => null;
    trx.schema = db.schema;
    return handler(trx);
  };
  return db;
};

const authHeadersFor = (role, id = `${role}-user`) => ({
  "x-test-user-id": id,
  "x-test-role": role,
});

const createDropsRuntimeHarness = ({ isUserLinkedToArtist = true } = {}) => {
  jest.resetModules();
  const state = createDropsState();
  const db = createDropsDb(state);

  jest.doMock(DB_MODULE_PATH, () => ({
    getDb: () => db,
  }));
  jest.doMock(AUTH_MIDDLEWARE_MODULE_PATH, () => ({
    requireAuth: (req, res, next) => {
      const userId = String(req.headers["x-test-user-id"] || "").trim();
      const role = String(req.headers["x-test-role"] || "").trim();
      if (!userId || !role) {
        return res.status(401).json({ error: "unauthorized" });
      }
      req.user = { id: userId, role };
      return next();
    },
    attachAuthUser: (_req, _res, next) => next(),
  }));
  jest.doMock(POLICY_MIDDLEWARE_MODULE_PATH, () => ({
    requirePolicy: () => (_req, _res, next) => next(),
  }));
  jest.doMock(OWNERSHIP_MODULE_PATH, () => ({
    isUserLinkedToArtist: jest.fn(async () => Boolean(isUserLinkedToArtist)),
    isLabelLinkedToArtist: jest.fn(async () => true),
    doesUserOwnLabel: jest.fn(async () => true),
  }));

  const dropsRouter = require(DROPS_ROUTE_MODULE_PATH);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = String(req.headers["x-test-user-id"] || "").trim();
    const role = String(req.headers["x-test-role"] || "").trim();
    if (userId && role) {
      req.user = { id: userId, role };
    }
    next();
  });
  app.use("/api/admin/drops", dropsRouter);
  app.use("/api/artist/drops", dropsRouter);
  app.use("/api/drops", dropsRouter);
  return { app, state };
};

module.exports = {
  authHeadersFor,
  createDropsRuntimeHarness,
};
