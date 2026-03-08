const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");

const CATALOG_SERVICE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/catalog/catalog.service.js"
);
const PRODUCT_VARIANTS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/catalog/productVariants.routes.js"
);

describe("catalog economics normalization", () => {
  test("new merch validation returns canonical economics fields", () => {
    const { validateNewMerch } = require(CATALOG_SERVICE_MODULE_PATH);
    const validation = validateNewMerch(
      {
        artist_id: "artist-1",
        merch_name: "Canonical Tee",
        merch_story: "Long enough merch story for validation",
        merch_type: "tshirt",
        colors: ["black"],
        selling_price_cents: 2400,
        vendor_pay: "9.00",
        royalty_cents: 300,
      },
      {},
      { requireListingPhotos: false }
    );

    assert.equal(validation.ok, true);
    assert.equal(validation.value.sellingPriceCents, 2400);
    assert.equal(validation.value.vendorPayoutCents, 900);
    assert.equal(validation.value.royaltyCents, 300);
    assert.equal(validation.value.ourShareCents, 1200);
    assert.equal("vendorPayCents" in validation.value, false);
  });

  test("new merch validation derives selling price from legacy split fields", () => {
    const { validateNewMerch } = require(CATALOG_SERVICE_MODULE_PATH);
    const validation = validateNewMerch(
      {
        artist_id: "artist-1",
        merch_name: "Legacy Split Tee",
        merch_story: "Legacy payload still uses payout/share/royalty split.",
        merch_type: "tshirt",
        colors: ["black"],
        vendor_pay: "8.00",
        our_share: "7.00",
        royalty: "4.99",
      },
      {},
      { requireListingPhotos: false }
    );

    assert.equal(validation.ok, true);
    assert.equal(validation.value.sellingPriceCents, 1999);
    assert.equal(validation.value.vendorPayoutCents, 800);
    assert.equal(validation.value.royaltyCents, 499);
    assert.equal(validation.value.ourShareCents, 700);
  });

  test("new merch validation allows parent create without explicit sell price", () => {
    const { validateNewMerch } = require(CATALOG_SERVICE_MODULE_PATH);
    const validation = validateNewMerch(
      {
        artist_id: "artist-1",
        merch_name: "Parent Only Tee",
        merch_story: "Parent product can be created before sellable listing pricing.",
        merch_type: "tshirt",
        colors: ["black"],
        vendor_pay: "8.00",
        royalty: "2.00",
      },
      {},
      { requireListingPhotos: false }
    );

    assert.equal(validation.ok, true);
    assert.equal(validation.value.sellingPriceCents, null);
  });

  test("variant normalization derives our_share_cents from selling/vendor/royalty", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      inventory_sku_id: "00000000-0000-4000-8000-000000000999",
      selling_price_cents: 2500,
      vendor_payout_cents: 1000,
      royalty_cents: 250,
    });

    assert.equal(normalized.error, undefined);
    assert.equal(normalized.value.our_share_cents, 1250);
  });

  test("variant normalization preserves explicit sku, size, and color", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      inventory_sku_id: "00000000-0000-4000-8000-000000000999",
      sku: "RACE-123",
      size: "M",
      color: "Race",
      selling_price_cents: 999,
    });

    assert.equal(normalized.error, undefined);
    assert.equal(normalized.value.sku, "RACE-123");
    assert.equal(normalized.value.size, "M");
    assert.equal(normalized.value.color, "Race");
  });

  test("variant normalization defaults size/color only when missing", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      inventory_sku_id: "00000000-0000-4000-8000-000000000999",
      selling_price_cents: 999,
    });

    assert.equal(normalized.error, undefined);
    assert.equal(normalized.value.size, "default");
    assert.equal(normalized.value.color, "default");
  });

  test("variant normalization rejects invalid negative derived our_share_cents", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      inventory_sku_id: "00000000-0000-4000-8000-000000000999",
      selling_price_cents: 1200,
      vendor_payout_cents: 1000,
      royalty_cents: 500,
    });

    assert.equal(normalized.error, "invalid_our_share_cents");
  });

  test("variant normalization keeps legacy update payloads compatible", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      priceCents: 2100,
      stock: 12,
    });

    assert.equal(normalized.error, undefined);
    assert.equal(normalized.value.inventory_sku_id, undefined);
    assert.equal(normalized.value.selling_price_cents, 2100);
    assert.equal(normalized.value.stock, 12);
  });

  test("listed variants require a positive sell price", () => {
    const { validateListedVariantPrice } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;

    assert.equal(
      validateListedVariantPrice({ isListed: true, sellingPriceCents: 0 }),
      false
    );
    assert.equal(
      validateListedVariantPrice({ isListed: true, sellingPriceCents: 1999 }),
      true
    );
    assert.equal(
      validateListedVariantPrice({ isListed: false, sellingPriceCents: 0 }),
      true
    );
  });
});
