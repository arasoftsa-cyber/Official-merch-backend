const path = require("node:path");

const ARTIST_ACCESS_VALIDATORS_PATH = path.resolve(
  __dirname,
  "../src/routes/artistAccessRequests.admin.validators.js"
);
const PRODUCT_VARIANTS_SERVICE_PATH = path.resolve(
  __dirname,
  "../src/routes/productVariants.service.js"
);
const PRODUCT_MUTATIONS_VALIDATORS_PATH = path.resolve(
  __dirname,
  "../src/controllers/catalog/operations/product-mutations.validators.js"
);

describe("refactor hotspot boundary coverage", () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.PREMIUM_PLAN_ENABLED;
  });

  it("approval validator normalizes basic plan payment fields", () => {
    const { validateApprovalPayload } = require(ARTIST_ACCESS_VALIDATORS_PATH);

    const result = validateApprovalPayload({
      final_plan_type: "basic",
      password: "AdminSet123!",
    });

    expect(result).toEqual({
      final_plan_type: "basic",
      payment_mode: "NA",
      transaction_id: "NA",
      password: "AdminSet123!",
    });
  });

  it("approval validator rejects advanced plan without payment fields", () => {
    const { validateApprovalPayload } = require(ARTIST_ACCESS_VALIDATORS_PATH);

    expect(() =>
      validateApprovalPayload({
        final_plan_type: "advanced",
        password: "AdminSet123!",
      })
    ).toThrow(/payment_mode and transaction_id are required/i);
  });

  it("variant service maps duplicate mapping error to 409 response", () => {
    const { putVariantErrorResponse } = require(PRODUCT_VARIANTS_SERVICE_PATH);

    const mapped = putVariantErrorResponse({ code: "DUPLICATE_INVENTORY_SKU_MAPPING" });

    expect(mapped).toEqual({
      statusCode: 409,
      body: { error: "duplicate_inventory_sku_mapping" },
    });
  });

  it("variant service returns null for unknown workflow errors", () => {
    const { putVariantErrorResponse } = require(PRODUCT_VARIANTS_SERVICE_PATH);

    const mapped = putVariantErrorResponse({ code: "SOME_UNKNOWN_ERROR" });

    expect(mapped).toBeNull();
  });

  it("product mutation validator rejects invalid status contract", () => {
    const { validateCreateProductInput, isHttpError } = require(PRODUCT_MUTATIONS_VALIDATORS_PATH);

    const result = validateCreateProductInput({
      body: {
        title: "Refactor Tee",
        artistId: "artist-1",
        status: "draft",
        priceCents: 1999,
      },
      fallbackBody: {},
    });

    expect(isHttpError(result)).toBe(true);
    expect(result.status).toBe(400);
    expect(result.payload?.error).toBe("validation");
    expect(Array.isArray(result.payload?.details)).toBe(true);
  });

  it("product mutation validator rejects invalid inventory sku id", () => {
    const { validateCreateProductInput, isHttpError } = require(PRODUCT_MUTATIONS_VALIDATORS_PATH);

    const result = validateCreateProductInput({
      body: {
        title: "Refactor Tee",
        artistId: "artist-1",
        priceCents: 1999,
        inventorySkuId: "not-a-uuid",
      },
      fallbackBody: {},
    });

    expect(isHttpError(result)).toBe(true);
    expect(result.status).toBe(400);
    expect(result.payload).toEqual({ error: "invalid_inventory_sku_id" });
  });

  it("product mutation validator keeps fallback artist id and defaults variant fields", () => {
    const { validateCreateProductInput, isHttpError } = require(PRODUCT_MUTATIONS_VALIDATORS_PATH);

    const result = validateCreateProductInput({
      body: {
        title: "Fallback Artist Tee",
        priceCents: 1999,
      },
      fallbackBody: {
        artistId: "artist-fallback-1",
      },
    });

    expect(isHttpError(result)).toBe(false);
    expect(result.artistId).toBe("artist-fallback-1");
    expect(result.normalizedSize).toBe("M");
    expect(result.normalizedColor).toBe("default");
    expect(result.variantStock).toBe(0);
  });
});
