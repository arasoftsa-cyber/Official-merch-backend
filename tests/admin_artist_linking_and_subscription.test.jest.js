"use strict";

const { __clearSchemaContractCacheForTests } = require("../src/core/db/schemaContract");

beforeEach(() => {
  __clearSchemaContractCacheForTests();
});

{
  const path = require("node:path");

  const ROUTE_MODULE_PATH = path.resolve(__dirname, "../src/routes/admin.routes.js");

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

  describe("admin artist linking", () => {
    it("first-time link inserts a new mapping", async () => {
      const routeModule = require(ROUTE_MODULE_PATH);
      const { reconcileArtistUserMapping } = routeModule.__test;
      const { db, state } = createFakeDb();

      const result = await reconcileArtistUserMapping({
        db,
        artistId: "artist-1",
        userId: "user-1",
      });

      expect(result.linked).toBe(true);
      expect(state.mappings.length).toBe(1);
      expect(state.mappings.map((row) => ({ artist_id: row.artist_id, user_id: row.user_id }))).toEqual([
        { artist_id: "artist-1", user_id: "user-1" },
      ]);
    });

    it("relink to same artist is idempotent", async () => {
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

      expect(result.idempotent).toBe(true);
      expect(state.mappings.length).toBe(1);
      expect(state.mappings[0].id).toBe("map-1");
      expect(state.mappings[0].artist_id).toBe("artist-1");
      expect(state.mappings[0].user_id).toBe("user-1");
    });

    it("relink from old artist to new artist replaces mapping safely", async () => {
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
      expect(userOneRows.length).toBe(1);
      expect(userOneRows[0].artist_id).toBe("artist-new");

      const userTwoRows = state.mappings.filter((row) => row.user_id === "user-2");
      expect(userTwoRows.length).toBe(1);
      expect(userTwoRows[0].artist_id).toBe("artist-2");
    });

    it("conflicting pre-existing rows are cleaned to one target mapping", async () => {
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
      expect(userRows.length).toBe(1);
      expect(userRows[0].artist_id).toBe("artist-target");
      expect(userRows[0].id).toBe("map-b");
    });
  });
}

{
  const path = require("node:path");
  const express = require("express");
  const request = require("supertest");

  const ONBOARDING_ROUTE_MODULE_PATH = path.resolve(
    __dirname,
    "../src/routes/onboarding.routes.js"
  );
  const LABEL_ROUTE_MODULE_PATH = path.resolve(__dirname, "../src/routes/label.routes.js");

  const pickCols = (row, cols) => {
    if (!Array.isArray(cols) || cols.length === 0) return { ...row };
    const out = {};
    for (const col of cols) out[String(col || "").split(".").pop()] = row[String(col || "").split(".").pop()];
    return out;
  };

  const createProvisioningDb = () => {
    const state = {
      artists: [],
      labels: [],
      label_artist_map: [],
    };

    const makeQuery = (tableName) => {
      const table = String(tableName || "").split(/\s+as\s+/i)[0].trim();
      const ctx = { whereObj: {} };
      const rows = () => (Array.isArray(state[table]) ? state[table] : []);
      const filteredRows = () =>
        rows().filter((row) =>
          Object.entries(ctx.whereObj).every(([key, value]) => row[key] === value)
        );

      const query = {
        where(whereObj) {
          ctx.whereObj = { ...ctx.whereObj, ...(whereObj || {}) };
          return query;
        },
        async first(...cols) {
          const row = filteredRows()[0] || null;
          return row ? pickCols(row, cols) : null;
        },
        async pluck(column) {
          const key = String(column || "").split(".").pop();
          return filteredRows().map((row) => row[key]);
        },
        async del() {
          const toRemove = new Set(filteredRows().map((row) => row.id));
          const before = rows().length;
          state[table] = rows().filter((row) => !toRemove.has(row.id));
          return before - state[table].length;
        },
        delete() {
          return query.del();
        },
        insert(payload) {
          const entries = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
            ...row,
            id: row.id || `${table}-${rows().length + 1}`,
          }));
          state[table].push(...entries);
          return {
            returning: async (cols) => entries.map((row) => pickCols(row, cols)),
            onConflict: () => ({
              ignore: async () => undefined,
            }),
          };
        },
      };

      return query;
    };

    const db = (tableName) => makeQuery(tableName);
    db.schema = { hasTable: async () => true };
    db.fn = { now: () => "2026-03-08T00:00:00.000Z" };
    db.transaction = async (handler) => handler(db);
    return { db, state };
  };

  const createProvisioningApp = ({ ownsLabel = true } = {}) => {
    const { db, state } = createProvisioningDb();

    jest.resetModules();
    jest.doMock("../src/core/db/db.js", () => ({
      getDb: () => db,
    }));
    jest.doMock("../src/core/http/auth.middleware", () => ({
      requireAuth: (req, res, next) => {
        const userId = String(req.headers["x-test-user-id"] || "").trim();
        const role = String(req.headers["x-test-role"] || "").trim();
        if (!userId) return res.status(401).json({ error: "unauthorized" });
        req.user = { id: userId, role: role || "admin" };
        return next();
      },
    }));
    jest.doMock("../src/core/http/policy.middleware", () => ({
      requirePolicy: () => (req, res, next) => next(),
    }));
    jest.doMock("../src/utils/ownership.js", () => ({
      doesUserOwnLabel: jest.fn(async (_db, userId, labelId) => {
        return ownsLabel && userId === "label-user" && labelId === "label-1";
      }),
      isLabelLinkedToArtist: jest.fn(async () => true),
      isUserLinkedToArtist: jest.fn(async () => true),
    }));

    const onboardingRouter = require(ONBOARDING_ROUTE_MODULE_PATH);
    const labelRouter = require(LABEL_ROUTE_MODULE_PATH);
    const app = express();
    app.use(express.json());
    app.use("/api/admin/provisioning", onboardingRouter);
    app.use("/api/labels", labelRouter);
    return { app, state };
  };

  const withUser = (id, role) => ({
    "x-test-user-id": id,
    "x-test-role": role,
  });

  describe("admin provisioning and label sales probe routes", () => {
    afterEach(() => {
      jest.resetModules();
    });

    it("supports create-artist/create-label/link-label-artist endpoint behavior", async () => {
      const { app, state } = createProvisioningApp();

      const createArtistRes = await request(app)
        .post("/api/admin/provisioning/create-artist")
        .set(withUser("admin-user", "admin"))
        .send({ handle: "new-artist", name: "New Artist", theme: {} });
      expect(createArtistRes.status).toBe(200);
      expect(createArtistRes.body?.artist?.id).toBeTruthy();

      const createArtistConflictRes = await request(app)
        .post("/api/admin/provisioning/create-artist")
        .set(withUser("admin-user", "admin"))
        .send({ handle: "new-artist", name: "New Artist", theme: {} });
      expect(createArtistConflictRes.status).toBe(409);
      expect(createArtistConflictRes.body?.error).toBe("artist_handle_exists");

      const createLabelRes = await request(app)
        .post("/api/admin/provisioning/create-label")
        .set(withUser("admin-user", "admin"))
        .send({ handle: "new-label", name: "New Label" });
      expect(createLabelRes.status).toBe(200);
      expect(createLabelRes.body?.label?.id).toBeTruthy();

      const createLabelConflictRes = await request(app)
        .post("/api/admin/provisioning/create-label")
        .set(withUser("admin-user", "admin"))
        .send({ handle: "new-label", name: "New Label" });
      expect(createLabelConflictRes.status).toBe(409);
      expect(createLabelConflictRes.body?.error).toBe("label_handle_exists");

      const linkRes = await request(app)
        .post("/api/admin/provisioning/link-label-artist")
        .set(withUser("admin-user", "admin"))
        .send({
          labelId: createLabelRes.body.label.id,
          artistId: createArtistRes.body.artist.id,
        });
      expect(linkRes.status).toBe(200);
      expect(linkRes.body).toEqual({ ok: true });
      expect(state.label_artist_map.length).toBe(1);
    });

    it("label sales-probe allows owned labels and forbids unowned labels", async () => {
      const allowedHarness = createProvisioningApp({ ownsLabel: true });
      const allowedRes = await request(allowedHarness.app)
        .get("/api/labels/label-1/artists/artist-1/sales-probe")
        .set(withUser("label-user", "label"));
      expect(allowedRes.status).toBe(200);
      expect(allowedRes.body).toEqual({
        ok: true,
        labelId: "label-1",
        artistId: "artist-1",
      });

      const forbiddenHarness = createProvisioningApp({ ownsLabel: false });
      const forbiddenRes = await request(forbiddenHarness.app)
        .get("/api/labels/label-1/artists/artist-1/sales-probe")
        .set(withUser("label-user", "label"));
      expect(forbiddenRes.status).toBe(403);
    });
  });
}

{
  const path = require("node:path");

  const ROUTE_MODULE_PATH = path.resolve(__dirname, "../src/routes/admin.routes.js");

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
          if (tableName === "artists") {
            return {
              id: {},
            };
          }
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
    it("returns active subscription payload", async () => {
      const routeModule = require(ROUTE_MODULE_PATH);
      const { fetchActiveArtistSubscriptionPayload } = routeModule.__test;
      const db = createFakeDb({ hasSubscription: true });

      const response = await fetchActiveArtistSubscriptionPayload(db, "artist-1");

      expect(response.statusCode).toBe(200);
      expect(response.body.artistId).toBe("artist-1");
      expect(response.body.approvedPlanType).toBe("advanced");
      expect(response.body.requestedPlanType).toBe("advanced");
    });

    it("returns null subscription when no active record exists", async () => {
      const routeModule = require(ROUTE_MODULE_PATH);
      const { fetchActiveArtistSubscriptionPayload } = routeModule.__test;
      const db = createFakeDb({ hasSubscription: false });

      const response = await fetchActiveArtistSubscriptionPayload(db, "artist-1");

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(null);
    });
  });
}

{
  const path = require("node:path");

  const ROUTE_MODULE_PATH = path.resolve(__dirname, "../src/routes/admin.routes.js");

  const pickColumns = (row, cols) => {
    if (!Array.isArray(cols) || cols.length === 0) return { ...row };
    const out = {};
    for (const col of cols) out[col] = row[col];
    return out;
  };

  const createFakeDb = ({ subscriptions }) => {
    const state = {
      artists: [{ id: "artist-1" }],
      subscriptions: subscriptions.map((row) => ({ ...row })),
    };

    const makeQuery = (tableName) => {
      const ctx = {
        whereObj: {},
        exclude: null,
      };

      const query = {
        where(whereObj) {
          ctx.whereObj = { ...ctx.whereObj, ...(whereObj || {}) };
          return query;
        },
        andWhereNot(column, value) {
          ctx.exclude = { column, value };
          return query;
        },
        async first(...cols) {
          if (tableName === "artists") {
            const row = state.artists.find((artist) =>
              Object.entries(ctx.whereObj).every(([key, value]) => artist[key] === value)
            );
            return row ? pickColumns(row, cols) : null;
          }
          if (tableName !== "artist_subscriptions") return null;
          const row = state.subscriptions.find((subscription) => {
            const matchesWhere = Object.entries(ctx.whereObj).every(
              ([key, value]) => subscription[key] === value
            );
            if (!matchesWhere) return false;
            if (ctx.exclude && subscription[ctx.exclude.column] === ctx.exclude.value) {
              return false;
            }
            return true;
          });
          return row ? pickColumns(row, cols) : null;
        },
        update(updatePayload) {
          if (tableName !== "artist_subscriptions") {
            return {
              returning: async () => [],
            };
          }
          let updated = null;
          for (let i = 0; i < state.subscriptions.length; i += 1) {
            const current = state.subscriptions[i];
            const matchesWhere = Object.entries(ctx.whereObj).every(
              ([key, value]) => current[key] === value
            );
            if (!matchesWhere) continue;
            const next = { ...current, ...updatePayload };
            state.subscriptions[i] = next;
            updated = next;
            break;
          }
          return {
            returning: async () => (updated ? [updated] : []),
          };
        },
        async columnInfo() {
          if (tableName === "artists") {
            return {
              id: {},
            };
          }
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

    const db = (tableName) => makeQuery(tableName);
    db.fn = {
      now: () => "2026-03-03T12:00:00.000Z",
    };
    db.schema = {
      hasTable: async (tableName) =>
        tableName === "artists" || tableName === "artist_subscriptions",
    };

    return { db, state };
  };

  describe("admin artist subscription update", () => {
    it("PATCH endDate works", async () => {
      const routeModule = require(ROUTE_MODULE_PATH);
      const { updateArtistSubscriptionAction } = routeModule.__test;
      const { db, state } = createFakeDb({
        subscriptions: [
          {
            id: "sub-1",
            artist_id: "artist-1",
            requested_plan_type: "basic",
            approved_plan_type: "advanced",
            start_date: "2026-01-01",
            end_date: "2027-01-08",
            payment_mode: "online",
            transaction_id: "TX-1",
            status: "active",
            approved_at: "2026-01-01T00:00:00.000Z",
            approved_by_admin_id: "admin-1",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      });

      const result = await updateArtistSubscriptionAction({
        db,
        subscriptionId: "sub-1",
        payload: { endDate: "2027-02-01" },
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.endDate).toBe("2027-02-01");
      expect(state.subscriptions[0].end_date).toBe("2027-02-01");
    });

    it("PATCH status=active fails when another active exists", async () => {
      const routeModule = require(ROUTE_MODULE_PATH);
      const { updateArtistSubscriptionAction } = routeModule.__test;
      const { db } = createFakeDb({
        subscriptions: [
          {
            id: "sub-1",
            artist_id: "artist-1",
            requested_plan_type: "basic",
            approved_plan_type: "advanced",
            start_date: "2026-01-01",
            end_date: "2027-01-08",
            payment_mode: "online",
            transaction_id: "TX-1",
            status: "expired",
            approved_at: "2026-01-01T00:00:00.000Z",
            approved_by_admin_id: "admin-1",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "sub-2",
            artist_id: "artist-1",
            requested_plan_type: "basic",
            approved_plan_type: "advanced",
            start_date: "2026-01-01",
            end_date: "2027-01-08",
            payment_mode: "cash",
            transaction_id: "TX-2",
            status: "active",
            approved_at: "2026-01-01T00:00:00.000Z",
            approved_by_admin_id: "admin-1",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      });

      const result = await updateArtistSubscriptionAction({
        db,
        subscriptionId: "sub-1",
        payload: { status: "active" },
      });

      expect(result.statusCode).toBe(409);
      expect(result.body.error).toBe("active_subscription_exists");
    });

    it("PATCH payment fields are rejected for basic plan", async () => {
      const routeModule = require(ROUTE_MODULE_PATH);
      const { updateArtistSubscriptionAction } = routeModule.__test;
      const { db } = createFakeDb({
        subscriptions: [
          {
            id: "sub-1",
            artist_id: "artist-1",
            requested_plan_type: "basic",
            approved_plan_type: "basic",
            start_date: "2026-01-01",
            end_date: "2027-01-08",
            payment_mode: "NA",
            transaction_id: "NA",
            status: "active",
            approved_at: "2026-01-01T00:00:00.000Z",
            approved_by_admin_id: "admin-1",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      });

      const result = await updateArtistSubscriptionAction({
        db,
        subscriptionId: "sub-1",
        payload: { paymentMode: "cash", transactionId: "TX-should-not-apply" },
      });

      expect(result.statusCode).toBe(400);
      expect(result.body.error).toBe("validation_error");
    });
  });
}

{
  const path = require("node:path");
  const DB_MODULE_PATH = path.resolve(__dirname, "../src/core/db/db.js");

  const ROUTE_MODULE_PATH = path.resolve(__dirname, "../src/routes/admin.routes.js");

  const ARTIST_COLUMNS = {
    id: {},
    name: {},
    handle: {},
    email: {},
    status: {},
    is_featured: {},
    phone: {},
    about_me: {},
    message_for_fans: {},
    socials: {},
    profile_photo_url: {},
    created_at: {},
  };

  const DIRECTORY_TABLE_COLUMNS = {
    artist_user_map: { id: {}, artist_id: {}, user_id: {} },
    users: { id: {}, email: {}, role: {} },
    artist_access_requests: {
      handle: {},
      email: {},
      phone: {},
      socials: {},
      about_me: {},
      message_for_fans: {},
      status: {},
      created_at: {},
    },
    entity_media_links: {
      id: {},
      media_asset_id: {},
      entity_type: {},
      entity_id: {},
      role: {},
      sort_order: {},
      created_at: {},
    },
    media_assets: { id: {}, public_url: {} },
  };

  const createFakeDb = () => {
    const artists = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Artist One",
        handle: "artistone",
        email: "artist.one@example.com",
        status: "active",
        is_featured: false,
        phone: "+49 123",
        about_me: "about",
        message_for_fans: "hello",
        socials: [],
        profile_photo_url: "https://cdn.example.com/p.jpg",
      },
    ];

    const makeQuery = (tableName) => {
      const ctx = { whereObj: {} };
      const query = {
        where(whereObj) {
          ctx.whereObj = { ...(ctx.whereObj || {}), ...(whereObj || {}) };
          return query;
        },
        whereIn() {
          return query;
        },
        select() {
          return query;
        },
        async first() {
          if (tableName !== "artists") return null;
          return (
            artists.find((row) =>
              Object.entries(ctx.whereObj).every(([key, value]) => row[key] === value)
            ) || null
          );
        },
        async columnInfo() {
          if (tableName === "artists") return ARTIST_COLUMNS;
          return DIRECTORY_TABLE_COLUMNS[tableName] || {};
        },
        async update() {
          return 0;
        },
        async delete() {
          return 0;
        },
        insert() {
          return {
            onConflict: () => ({
              ignore: async () => undefined,
            }),
          };
        },
      };
      return query;
    };

    const db = (tableName) => makeQuery(tableName);
    db.schema = {
      hasTable: async (tableName) =>
        tableName === "artists" || Object.prototype.hasOwnProperty.call(DIRECTORY_TABLE_COLUMNS, tableName),
    };
    db.transaction = async (handler) => {
      const trx = (tableName) => makeQuery(tableName);
      trx.fn = { now: () => "2026-03-03T00:00:00.000Z" };
      trx.raw = () => null;
      return handler(trx);
    };
    db.fn = { now: () => "2026-03-03T00:00:00.000Z" };
    db.raw = () => null;
    return db;
  };

  const createMockResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  });

  const getPatchArtistHandler = (router) => {
    const layer = router.stack.find(
      (entry) => entry?.route?.path === "/artists/:id" && entry?.route?.methods?.patch
    );
    if (!layer) {
      throw new Error("PATCH /artists/:id route handler not found");
    }
    const handlers = Array.isArray(layer.route.stack) ? layer.route.stack : [];
    if (!handlers.length) {
      throw new Error("PATCH /artists/:id handlers are empty");
    }
    return handlers[handlers.length - 1].handle;
  };

  const loadPatchArtistHandler = (dbFactory = createFakeDb) => {
    let handler = null;
    jest.isolateModules(() => {
      const dbModule = require(DB_MODULE_PATH);
      dbModule.getDb = () => dbFactory();
      const router = require(ROUTE_MODULE_PATH);
      handler = getPatchArtistHandler(router);
    });
    if (!handler) {
      throw new Error("PATCH /artists/:id handler failed to load");
    }
    return handler;
  };

  const createIncompleteSchemaDb = () => {
    const db = createFakeDb();
    const originalDb = db;
    const wrapped = (tableName) => {
      const query = originalDb(tableName);
      if (tableName === "artists") {
        return {
          ...query,
          async columnInfo() {
            return {
              id: {},
              name: {},
              handle: {},
            };
          },
        };
      }
      return query;
    };
    wrapped.schema = originalDb.schema;
    wrapped.transaction = originalDb.transaction;
    wrapped.fn = originalDb.fn;
    wrapped.raw = originalDb.raw;
    return wrapped;
  };

  describe("admin artist patch route", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("rejects truly empty update payload with no_fields", async () => {
      const handler = loadPatchArtistHandler();
      const req = {
        params: { id: "00000000-0000-4000-8000-000000000001" },
        body: {},
        user: { role: "admin", id: "admin-id" },
      };
      const res = createMockResponse();

      await handler(req, res, () => null);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "no_fields" });
    });

    it("fails clearly when the admin artist schema contract is missing", async () => {
      const handler = loadPatchArtistHandler(createIncompleteSchemaDb);
      const req = {
        params: { id: "00000000-0000-4000-8000-000000000001" },
        body: { name: "Updated Name" },
        user: { role: "admin", id: "admin-id" },
      };
      const res = createMockResponse();

      await handler(req, res, () => null);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        error: "schema_not_ready",
        message: "Required database migrations have not been applied.",
      });
    });
  });
}
