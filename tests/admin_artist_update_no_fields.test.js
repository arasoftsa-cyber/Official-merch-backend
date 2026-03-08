const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");

const ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/orders/admin.routes.js"
);
const DB_MODULE_PATH = path.resolve(__dirname, "../src/core/db/db.js");

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
};

const createFakeDb = () => {
  const artists = [
    {
      id: "artist-1",
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

  const db = (tableName) => {
    const ctx = {
      whereObj: {},
    };

    const query = {
      where(whereObj) {
        ctx.whereObj = { ...ctx.whereObj, ...(whereObj || {}) };
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
        if (tableName !== "artists") return {};
        return ARTIST_COLUMNS;
      },
      async update() {
        return 0;
      },
    };

    return query;
  };

  db.schema = {
    hasTable: async (tableName) => tableName === "artists",
  };
  db.transaction = async (handler) => handler(db);
  db.raw = () => null;

  return db;
};

const createMockResponse = () => {
  const response = {
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
  };
  return response;
};

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

describe("admin artist patch route", () => {
  test("rejects truly empty update payload with no_fields", async () => {
    const originalDbModule = require(DB_MODULE_PATH);

    delete require.cache[ROUTE_MODULE_PATH];
    delete require.cache[DB_MODULE_PATH];

    require.cache[DB_MODULE_PATH] = {
      id: DB_MODULE_PATH,
      filename: DB_MODULE_PATH,
      loaded: true,
      exports: {
        ...originalDbModule,
        getDb: () => createFakeDb(),
      },
    };

    const router = require(ROUTE_MODULE_PATH);
    const handler = getPatchArtistHandler(router);

    const req = {
      params: { id: "artist-1" },
      body: {},
      user: { role: "admin" },
    };
    const res = createMockResponse();

    try {
      await handler(req, res, () => null);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { error: "no_fields" });
    } finally {
      delete require.cache[ROUTE_MODULE_PATH];
      delete require.cache[DB_MODULE_PATH];
      require.cache[DB_MODULE_PATH] = {
        id: DB_MODULE_PATH,
        filename: DB_MODULE_PATH,
        loaded: true,
        exports: originalDbModule,
      };
    }
  });
});
