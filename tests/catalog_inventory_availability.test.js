const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");

const ORDERS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/orders/orders.routes.js"
);
const PRODUCT_VARIANTS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/catalog/productVariants.routes.js"
);
const VARIANT_AVAILABILITY_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/catalog/variantAvailability.js"
);

describe("inventory-driven availability helpers", () => {
  test("inactive SKU makes variant effectively unavailable", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { isVariantEffectivelySellable } = routeModule.__test;

    const sellable = isVariantEffectivelySellable({
      product_is_active: true,
      is_listed: true,
      sku_is_active: false,
      stock: 10,
    });

    assert.equal(sellable, false);
  });

  test("zero stock SKU makes variant unsellable", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { isVariantEffectivelySellable } = routeModule.__test;

    const sellable = isVariantEffectivelySellable({
      product_is_active: true,
      is_listed: true,
      sku_is_active: true,
      stock: 0,
    });

    assert.equal(sellable, false);
  });

  test("listed=false variant remains unavailable even with active in-stock SKU", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { isVariantEffectivelySellable } = routeModule.__test;

    const sellable = isVariantEffectivelySellable({
      product_is_active: true,
      is_listed: false,
      sku_is_active: true,
      stock: 50,
    });

    assert.equal(sellable, false);
  });

  test("duplicate (product, inventory_sku) mapping is rejected by helper", () => {
    const routeModule = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH);
    const { validateUniqueInventorySkuMappings } = routeModule.__test;

    const isUnique = validateUniqueInventorySkuMappings([
      { id: "v1", inventory_sku_id: "00000000-0000-4000-8000-000000000111" },
      { id: "v2", inventory_sku_id: "00000000-0000-4000-8000-000000000111" },
    ]);

    assert.equal(isUnique, false);
  });

  test("variant serializer keeps canonical and legacy aliases for readback compatibility", () => {
    const moduleRef = require(VARIANT_AVAILABILITY_MODULE_PATH);
    const { formatVariantInventoryRow } = moduleRef;

    const variant = formatVariantInventoryRow({
      id: "00000000-0000-4000-8000-000000000111",
      product_id: "00000000-0000-4000-8000-000000000222",
      sku: "RACE-SKU",
      size: "M",
      color: "Race",
      inventory_sku_id: "00000000-0000-4000-8000-000000000333",
      supplier_sku: "LEGACY-RACE-M",
      merch_type: "default",
      quality_tier: null,
      stock: 1,
      sku_is_active: true,
      variant_is_listed: true,
      effective_is_active: true,
      effective_sellable: true,
      selling_price_cents: 999,
      price_cents: 999,
      vendor_payout_cents: null,
      royalty_cents: null,
      our_share_cents: null,
    });

    assert.equal(variant.id, "00000000-0000-4000-8000-000000000111");
    assert.equal(variant.product_id, "00000000-0000-4000-8000-000000000222");
    assert.equal(variant.productId, "00000000-0000-4000-8000-000000000222");
    assert.equal(variant.inventory_sku_id, "00000000-0000-4000-8000-000000000333");
    assert.equal(variant.inventorySkuId, "00000000-0000-4000-8000-000000000333");
    assert.equal(variant.supplier_sku, "LEGACY-RACE-M");
    assert.equal(variant.supplierSku, "LEGACY-RACE-M");
    assert.equal(variant.price_cents, 999);
    assert.equal(variant.priceCents, 999);
    assert.equal(variant.selling_price_cents, 999);
    assert.equal(variant.sellingPriceCents, 999);
    assert.equal(variant.stock, 1);
    assert.equal(variant.effective_is_active, true);
    assert.equal(variant.effectiveIsActive, true);
    assert.equal(variant.effective_sellable, true);
    assert.equal(variant.effectiveSellable, true);
  });

  test("touched variants are ordered first in variant upsert responses", () => {
    const routeModule = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH);
    const { orderVariantsByTouchedIds } = routeModule.__test;

    const ordered = orderVariantsByTouchedIds(
      [
        { id: "default-variant", sku: "DEFAULT" },
        { id: "race-variant", sku: "RACE-1" },
      ],
      ["race-variant"]
    );

    assert.equal(ordered[0].id, "race-variant");
    assert.equal(ordered[1].id, "default-variant");
  });
});
