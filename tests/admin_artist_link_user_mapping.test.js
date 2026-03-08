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

const createFakeDb = ({ mappings = [] } = {}) => {
  const state = {
    mappings: mappings.map((row) => ({ ...row })),
  };

  const applyFilters = (rows, whereObj, whereIn) =>
    rows.filter((row) => {
      const matchesWhere = Object.entries(whereObj || {}).every(
        ([key, value]) => row[key] === value
      );
      if (!matchesWhere) return false;
      if (whereIn && whereIn.column) {
        return Array.isArray(whereIn.values) && whereIn.values.includes(row[whereIn.column]);
      }
      return true;
    });

  const makeQuery = (tableName) => {
    if (tableName !== "artist_user_map") {
      throw new Error(`unsupported table: ${tableName}`);
    }

    const ctx = {
      whereObj: {},
      whereIn: null,
    };

    const query = {
      where(whereObj) {
        ctx.whereObj = { ...ctx.whereObj, ...(whereObj || {}) };
        return query;
      },
      whereIn(column, values) {
        ctx.whereIn = {
          column,
          values: Array.isArray(values) ? values.slice() : [],
        };
        return query;
      },
      async select(...cols) {
        const rows = applyFilters(state.mappings, ctx.whereObj, ctx.whereIn);
        return rows.map((row) => pickColumns(row, cols));
      },
      async first(...cols) {
        const rows = applyFilters(state.mappings, ctx.whereObj, ctx.whereIn);
        return rows.length > 0 ? pickColumns(rows[0], cols) : null;
      },
      async delete() {
        const before = state.mappings.length;
        const matches = applyFilters(state.mappings, ctx.whereObj, ctx.whereIn);
        const ids = new Set(matches.map((row) => row.id));
        state.mappings = state.mappings.filter((row) => !ids.has(row.id));
        return before - state.mappings.length;
      },
      async insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const row of rows) {
          const conflict = state.mappings.find(
            (entry) =>
              entry.artist_id === row.artist_id && entry.user_id === row.user_id
          );
          if (conflict) {
            const err = new Error("duplicate key value violates unique constraint");
            err.code = "23505";
            throw err;
          }
        }
        state.mappings.push(...rows.map((row) => ({ ...row })));
        return rows.length;
      },
      async update(patch) {
        const rows = applyFilters(state.mappings, ctx.whereObj, ctx.whereIn);
        let updatedCount = 0;

        for (const row of rows) {
          const next = { ...row, ...patch };
          const conflict = state.mappings.find(
            (entry) =>
              entry.id !== row.id &&
              entry.artist_id === next.artist_id &&
              entry.user_id === next.user_id
          );
          if (conflict) {
            const err = new Error("duplicate key value violates unique constraint");
            err.code = "23505";
            throw err;
          }

          const index = state.mappings.findIndex((entry) => entry.id === row.id);
          if (index >= 0) {
            state.mappings[index] = next;
            updatedCount += 1;
          }
        }

        return updatedCount;
      },
    };

    return query;
  };

  const db = (tableName) => makeQuery(tableName);
  db.transaction = async (handler) => handler(db);

  return { db, state };
};

describe("admin artist link-user mapping reconciliation", () => {
  test("first-time link inserts a new mapping", async () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { reconcileArtistUserMapping } = routeModule.__test;
    const { db, state } = createFakeDb();

    const result = await reconcileArtistUserMapping({
      db,
      artistId: "artist-1",
      userId: "user-1",
    });

    assert.equal(result.linked, true);
    assert.equal(state.mappings.length, 1);
    assert.deepEqual(
      state.mappings.map((row) => ({ artist_id: row.artist_id, user_id: row.user_id })),
      [{ artist_id: "artist-1", user_id: "user-1" }]
    );
  });

  test("relink to same artist is idempotent", async () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { reconcileArtistUserMapping } = routeModule.__test;
    const { db, state } = createFakeDb({
      mappings: [{ id: "map-1", artist_id: "artist-1", user_id: "user-1" }],
    });

    const result = await reconcileArtistUserMapping({
      db,
      artistId: "artist-1",
      userId: "user-1",
    });

    assert.equal(result.idempotent, true);
    assert.equal(state.mappings.length, 1);
    assert.equal(state.mappings[0].id, "map-1");
    assert.equal(state.mappings[0].artist_id, "artist-1");
    assert.equal(state.mappings[0].user_id, "user-1");
  });

  test("relink from old artist to new artist replaces mapping safely", async () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { reconcileArtistUserMapping } = routeModule.__test;
    const { db, state } = createFakeDb({
      mappings: [
        { id: "map-1", artist_id: "artist-old", user_id: "user-1" },
        { id: "map-2", artist_id: "artist-2", user_id: "user-2" },
      ],
    });

    await reconcileArtistUserMapping({
      db,
      artistId: "artist-new",
      userId: "user-1",
    });

    const userOneRows = state.mappings.filter((row) => row.user_id === "user-1");
    assert.equal(userOneRows.length, 1);
    assert.equal(userOneRows[0].artist_id, "artist-new");

    const userTwoRows = state.mappings.filter((row) => row.user_id === "user-2");
    assert.equal(userTwoRows.length, 1);
    assert.equal(userTwoRows[0].artist_id, "artist-2");
  });

  test("conflicting pre-existing rows are cleaned to one target mapping", async () => {
    const routeModule = require(ROUTE_MODULE_PATH);
    const { reconcileArtistUserMapping } = routeModule.__test;
    const { db, state } = createFakeDb({
      mappings: [
        { id: "map-a", artist_id: "artist-legacy", user_id: "user-1" },
        { id: "map-b", artist_id: "artist-target", user_id: "user-1" },
        { id: "map-c", artist_id: "artist-stale", user_id: "user-1" },
      ],
    });

    await reconcileArtistUserMapping({
      db,
      artistId: "artist-target",
      userId: "user-1",
    });

    const userRows = state.mappings.filter((row) => row.user_id === "user-1");
    assert.equal(userRows.length, 1);
    assert.equal(userRows[0].artist_id, "artist-target");
    assert.equal(userRows[0].id, "map-b");
  });
});

