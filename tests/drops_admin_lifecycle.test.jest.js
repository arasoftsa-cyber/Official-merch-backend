const path = require("node:path");
const request = require("supertest");
const {
  createDropsRuntimeHarness,
  authHeadersFor,
} = require("./helpers/dropsRuntimeHarness");

const DROPS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/drops.routes.js"
);

const listRoutes = (router) => {
  const rows = [];
  for (const layer of router.stack || []) {
    if (!layer?.route?.path || !layer.route.methods) continue;
    const methods = Object.keys(layer.route.methods)
      .filter((method) => layer.route.methods[method])
      .map((method) => method.toUpperCase());
    for (const method of methods) {
      rows.push({ method, path: layer.route.path, handlers: layer.route.stack || [] });
    }
  }
  return rows;
};

describe("drops admin lifecycle", () => {
  it("registers core mutation routes for drop lifecycle", () => {
    const router = require(DROPS_ROUTE_MODULE_PATH);
    const routes = listRoutes(router);

    const expected = [
      { method: "POST", path: "/" },
      { method: "PATCH", path: "/:id" },
      { method: "PUT", path: "/:id/products" },
      { method: "POST", path: "/:handle/products" },
      { method: "POST", path: "/:handle/publish" },
      { method: "POST", path: "/:handle/unpublish" },
      { method: "POST", path: "/:handle/archive" },
    ];

    for (const item of expected) {
      const route = routes.find(
        (row) => row.method === item.method && row.path === item.path
      );
      expect(route).toBeTruthy();
      expect(Array.isArray(route.handlers)).toBe(true);
      expect(route.handlers.length).toBeGreaterThan(1);
    }
  });

  it("keeps public featured and products read routes registered", () => {
    const router = require(DROPS_ROUTE_MODULE_PATH);
    const routes = listRoutes(router);

    expect(
      routes.some((row) => row.method === "GET" && row.path === "/featured")
    ).toBe(true);
    expect(
      routes.some((row) => row.method === "GET" && row.path === "/:handle/products")
    ).toBe(true);
    expect(
      routes.some((row) => row.method === "GET" && row.path === "/:id/products")
    ).toBe(true);
  });

  it("creates draft, attaches product, publishes, unpublishes, and archives via admin scope", async () => {
    const { app, state } = createDropsRuntimeHarness();
    const adminHeaders = authHeadersFor("admin", "admin-user");
    const artistId = state.artists[0].id;
    const productId = state.products[0].id;

    const createResponse = await request(app)
      .post("/api/admin/drops")
      .set(adminHeaders)
      .send({
        title: "Lifecycle Drop",
        artistId,
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body?.drop?.status).toBe("draft");
    const handle = createResponse.body?.drop?.handle;
    expect(typeof handle).toBe("string");

    const attachResponse = await request(app)
      .post(`/api/admin/drops/${handle}/products`)
      .set(adminHeaders)
      .send({ productId, sortOrder: 0 });
    expect(attachResponse.status).toBe(200);
    expect(attachResponse.body?.ok).toBe(true);

    const publishResponse = await request(app)
      .post(`/api/admin/drops/${handle}/publish`)
      .set(adminHeaders)
      .send({});
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body?.drop?.status).toBe("published");

    const unpublishResponse = await request(app)
      .post(`/api/admin/drops/${handle}/unpublish`)
      .set(adminHeaders)
      .send({});
    expect(unpublishResponse.status).toBe(200);
    expect(unpublishResponse.body?.drop?.status).toBe("draft");

    const archiveResponse = await request(app)
      .post(`/api/admin/drops/${handle}/archive`)
      .set(adminHeaders)
      .send({});
    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body?.drop?.status).toBe("archived");
  });

  it("forbids foreign artist scope mutations when the user is not linked to the drop artist", async () => {
    const { app, state } = createDropsRuntimeHarness({ isUserLinkedToArtist: false });
    const adminHeaders = authHeadersFor("admin", "admin-user");
    const artistHeaders = authHeadersFor("artist", "artist-user");

    const createResponse = await request(app)
      .post("/api/admin/drops")
      .set(adminHeaders)
      .send({ title: "Scope Drop", artistId: state.artists[0].id });
    expect(createResponse.status).toBe(201);
    const handle = createResponse.body?.drop?.handle;

    const attachResponse = await request(app)
      .post(`/api/admin/drops/${handle}/products`)
      .set(adminHeaders)
      .send({ productId: state.products[0].id, sortOrder: 0 });
    expect(attachResponse.status).toBe(200);

    const artistCreateResponse = await request(app)
      .post("/api/artist/drops")
      .set(artistHeaders)
      .send({ title: "Artist Create Attempt", artistId: state.artists[0].id });
    expect(artistCreateResponse.status).toBe(403);

    const artistPublishResponse = await request(app)
      .post(`/api/artist/drops/${handle}/publish`)
      .set(artistHeaders)
      .send({});
    expect(artistPublishResponse.status).toBe(403);
    expect(artistPublishResponse.body?.error).toBe("forbidden");
  });

  it("artist scope lists own drop, cannot attach products, and can publish/unpublish own drop", async () => {
    const { app, state } = createDropsRuntimeHarness({ isUserLinkedToArtist: true });
    const adminHeaders = authHeadersFor("admin", "admin-user");
    const artistHeaders = authHeadersFor("artist", "artist-user");

    const createResponse = await request(app)
      .post("/api/admin/drops")
      .set(adminHeaders)
      .send({ title: "Artist Scope Own Drop", artistId: state.artists[0].id });
    expect(createResponse.status).toBe(201);
    const handle = createResponse.body?.drop?.handle;

    await request(app)
      .post(`/api/admin/drops/${handle}/products`)
      .set(adminHeaders)
      .send({ productId: state.products[0].id, sortOrder: 0 })
      .expect(200);

    const listResponse = await request(app)
      .get("/api/artist/drops")
      .set(artistHeaders);
    expect(listResponse.status).toBe(200);
    const items = Array.isArray(listResponse.body?.items) ? listResponse.body.items : [];
    expect(items.some((row) => row?.handle === handle)).toBe(true);

    const attachFromArtistScope = await request(app)
      .post(`/api/artist/drops/${handle}/products`)
      .set(artistHeaders)
      .send({ productId: state.products[0].id });
    expect(attachFromArtistScope.status).toBe(403);

    const publishResponse = await request(app)
      .post(`/api/artist/drops/${handle}/publish`)
      .set(artistHeaders)
      .send({});
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body?.drop?.status).toBe("published");

    const unpublishResponse = await request(app)
      .post(`/api/artist/drops/${handle}/unpublish`)
      .set(artistHeaders)
      .send({});
    expect(unpublishResponse.status).toBe(200);
    expect(unpublishResponse.body?.drop?.status).toBe("draft");
  });
});
