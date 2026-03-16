process.env.NODE_ENV = "test";

const request = require("supertest");

jest.mock("../scripts/seed_ui_smoke", () => ({
  seedUiSmoke: jest.fn(async () => ({
    adminUser: { id: "admin-1", email: "admin@test.com" },
    buyerUser: { id: "buyer-1", email: "buyer@test.com" },
    artistUser: { id: "artist-user-1", email: "artist@test.com" },
    labelUser: { id: "label-user-1", email: "label@test.com" },
    artist: { id: "artist-1", handle: "seed-artist", name: "Seed Artist" },
    label: { id: "label-1", handle: "seed-label", name: "Seed Label" },
    product: { id: "product-1", title: "Seed Artist Tee" },
    variant: { id: "variant-1", sku: "SEED-SKU-1" },
    drop: { id: "drop-1", handle: "seed-drop" },
    order: { id: "order-1" },
  })),
}));

jest.mock("../src/services/catalog.service", () => ({
  ...jest.requireActual("../src/services/catalog.service"),
  createProductWithVariants: jest.fn(async () => "seeded-product-2"),
}));

const app = require("../app");

describe("playwright local test-support routes", () => {
  beforeEach(() => {
    process.env.PLAYWRIGHT_TEST_SUPPORT_KEY = "om-playwright-local";
  });

  afterEach(() => {
    delete process.env.PLAYWRIGHT_TEST_SUPPORT_KEY;
  });

  it("POST /api/test-support/playwright/bootstrap returns deterministic items", async () => {
    const response = await request(app)
      .post("/api/test-support/playwright/bootstrap")
      .set("x-playwright-test-support-key", "om-playwright-local");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: expect.objectContaining({
        adminUser: expect.objectContaining({ id: "admin-1" }),
        buyerUser: expect.objectContaining({ id: "buyer-1" }),
        artist: expect.objectContaining({ id: "artist-1", handle: "seed-artist" }),
        drop: expect.objectContaining({ id: "drop-1" }),
      }),
    });
  });

  it("POST /api/test-support/playwright/products returns a seeded product envelope", async () => {
    const response = await request(app)
      .post("/api/test-support/playwright/products")
      .set("x-playwright-test-support-key", "om-playwright-local")
      .send({
        title: "PW active seeded tee",
        status: "active",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      items: expect.objectContaining({
        productId: "seeded-product-2",
        artistId: "artist-1",
        artistHandle: "seed-artist",
        status: "active",
        title: "PW active seeded tee",
      }),
    });
  });
});
