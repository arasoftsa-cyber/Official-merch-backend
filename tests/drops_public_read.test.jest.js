const path = require("node:path");
const knexFactory = require("knex");
const request = require("supertest");
const {
  createDropsRuntimeHarness,
  authHeadersFor,
} = require("./helpers/dropsRuntimeHarness");

const DROPS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/drops.routes.js"
);
const VARIANT_AVAILABILITY_MODULE_PATH = path.resolve(
  __dirname,
  "../src/services/variantAvailability.service.js"
);

describe("drops public read", () => {
  it("uses aggregated drop sort order and safe group-by ordering", () => {
    const db = knexFactory({ client: "pg" });
    const { applyDropProductOrdering, applyPublicActiveProductFilter } = require(
      DROPS_ROUTE_MODULE_PATH
    ).__test;
    const { buildSellableMinPriceSubquery, applySellableVariantExists } = require(
      VARIANT_AVAILABILITY_MODULE_PATH
    );

    const query = db("drop_products as dp")
      .join("products as p", "dp.product_id", "p.id")
      .select(
        "p.id",
        "p.title",
        "p.artist_id",
        "p.is_active",
        buildSellableMinPriceSubquery(db, { productRef: "p.id" }).wrap("(", ") as price_cents")
      )
      .where("dp.drop_id", "drop-1");
    applyPublicActiveProductFilter(query, {
      productRef: "p",
      hasStatus: true,
      hasIsActive: true,
    });
    applySellableVariantExists(query, { productRef: "p.id" });
    applyDropProductOrdering(query);

    const sql = query.toSQL().sql.toLowerCase();
    expect(sql).toMatch(/"p"\."status" = \?/);
    expect(sql).toMatch(/min\(dp\.sort_order\) as drop_sort_order/);
    expect(sql).toMatch(/group by .*"p"\."created_at"/);
    expect(sql).toMatch(/order by "drop_sort_order" asc, "p"\."created_at" desc/);
  });

  it("enforces sellable variant existence with active in-stock SKU", () => {
    const db = knexFactory({ client: "pg" });
    const { applyDropProductOrdering, applyPublicActiveProductFilter } = require(
      DROPS_ROUTE_MODULE_PATH
    ).__test;
    const { buildSellableMinPriceSubquery, applySellableVariantExists } = require(
      VARIANT_AVAILABILITY_MODULE_PATH
    );

    const query = db("drop_products as dp")
      .join("products as p", "dp.product_id", "p.id")
      .select(
        "p.id",
        buildSellableMinPriceSubquery(db, { productRef: "p.id" }).wrap("(", ") as price_cents")
      )
      .where("dp.drop_id", "drop-1");
    applyPublicActiveProductFilter(query, {
      productRef: "p",
      hasStatus: true,
      hasIsActive: true,
    });
    applySellableVariantExists(query, { productRef: "p.id" });
    applyDropProductOrdering(query, { includeCreatedAt: false });

    const sql = query.toSQL().sql.toLowerCase();
    expect(sql).toMatch(/"p"\."status" = \?/);
    expect(sql).toMatch(/exists \(select 1 from "product_variants"/);
    expect(sql).toMatch(/coalesce\(v\.is_listed, true\) = true/);
    expect(sql).toMatch(/sk\.is_active/);
    expect(sql).toMatch(/sk\.stock/);
  });

  it("falls back to is_active filter when status column is unavailable", () => {
    const db = knexFactory({ client: "pg" });
    const { applyPublicActiveProductFilter } = require(DROPS_ROUTE_MODULE_PATH).__test;

    const query = db("drop_products as dp")
      .join("products as p", "dp.product_id", "p.id")
      .select("p.id")
      .where("dp.drop_id", "drop-1");
    applyPublicActiveProductFilter(query, {
      productRef: "p",
      hasStatus: false,
      hasIsActive: true,
    });

    const sql = query.toSQL().sql.toLowerCase();
    expect(sql).toMatch(/"p"\."is_active" = \?/);
  });

  it("published drops are visible on public handle and featured feeds", async () => {
    const { app, state } = createDropsRuntimeHarness();
    const adminHeaders = authHeadersFor("admin", "admin-user");

    const createResponse = await request(app)
      .post("/api/admin/drops")
      .set(adminHeaders)
      .send({ title: "Public Visibility Drop", artistId: state.artists[0].id });
    expect(createResponse.status).toBe(201);
    const handle = createResponse.body?.drop?.handle;

    await request(app)
      .post(`/api/admin/drops/${handle}/products`)
      .set(adminHeaders)
      .send({ productId: state.products[0].id, sortOrder: 0 })
      .expect(200);

    await request(app)
      .post(`/api/admin/drops/${handle}/publish`)
      .set(adminHeaders)
      .send({})
      .expect(200);

    const detailResponse = await request(app).get(`/api/drops/${handle}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body?.drop?.handle).toBe(handle);
    expect(detailResponse.body?.drop?.status).toBe("published");

    const featuredResponse = await request(app).get("/api/drops/featured");
    expect(featuredResponse.status).toBe(200);
    const featuredHandles = (featuredResponse.body?.items || []).map((row) => row.handle);
    expect(featuredHandles).toContain(handle);
  });

  it("unpublished or archived drops are hidden from public routes and featured feed", async () => {
    const { app, state } = createDropsRuntimeHarness();
    const adminHeaders = authHeadersFor("admin", "admin-user");

    const createResponse = await request(app)
      .post("/api/admin/drops")
      .set(adminHeaders)
      .send({ title: "Public Hidden Drop", artistId: state.artists[0].id });
    expect(createResponse.status).toBe(201);
    const handle = createResponse.body?.drop?.handle;

    await request(app)
      .post(`/api/admin/drops/${handle}/products`)
      .set(adminHeaders)
      .send({ productId: state.products[0].id, sortOrder: 0 })
      .expect(200);

    await request(app)
      .post(`/api/admin/drops/${handle}/publish`)
      .set(adminHeaders)
      .send({})
      .expect(200);

    await request(app)
      .post(`/api/admin/drops/${handle}/unpublish`)
      .set(adminHeaders)
      .send({})
      .expect(200);

    const hiddenAfterUnpublish = await request(app).get(`/api/drops/${handle}`);
    expect(hiddenAfterUnpublish.status).toBe(404);

    await request(app)
      .post(`/api/admin/drops/${handle}/archive`)
      .set(adminHeaders)
      .send({})
      .expect(200);

    const hiddenAfterArchive = await request(app).get(`/api/drops/${handle}`);
    expect(hiddenAfterArchive.status).toBe(404);

    const featuredResponse = await request(app).get("/api/drops/featured");
    expect(featuredResponse.status).toBe(200);
    const featuredHandles = (featuredResponse.body?.items || []).map((row) => row.handle);
    expect(featuredHandles).not.toContain(handle);
  });
});

