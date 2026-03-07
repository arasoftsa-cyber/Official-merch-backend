const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");

const ORDERS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/orders/orders.routes.js"
);

describe("checkout stock reservation uses inventory_skus", () => {
  test("order item payload captures inventory + pricing snapshot fields", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { buildOrderItemInsertPayload } = routeModule.__test;

    const payload = buildOrderItemInsertPayload({
      columns: {
        inventory_sku_id: {},
        supplier_sku: {},
        merch_type: {},
        quality_tier: {},
        size: {},
        color: {},
        selling_price_cents: {},
        vendor_payout_cents: {},
        royalty_cents: {},
        our_share_cents: {},
      },
      orderId: "00000000-0000-4000-8000-000000000001",
      line: {
        productId: "00000000-0000-4000-8000-000000000010",
        productVariantId: "00000000-0000-4000-8000-000000000020",
        quantity: 1,
      },
      variant: {
        inventory_sku_id: "00000000-0000-4000-8000-000000000999",
        supplier_sku: "SUP-001",
        merch_type: "tee",
        quality_tier: "premium",
        size: "M",
        color: "black",
        selling_price_cents: 1999,
        vendor_payout_cents: 750,
        royalty_cents: 250,
        our_share_cents: 999,
      },
      now: new Date().toISOString(),
    });

    assert.equal(payload.inventory_sku_id, "00000000-0000-4000-8000-000000000999");
    assert.equal(payload.supplier_sku, "SUP-001");
    assert.equal(payload.selling_price_cents, 1999);
    assert.equal(payload.vendor_payout_cents, 750);
    assert.equal(payload.royalty_cents, 250);
    assert.equal(payload.our_share_cents, 999);
  });

  test("fails when SKU stock is insufficient", async () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { reserveInventoryForLine } = routeModule.__test;

    const line = {
      productId: "00000000-0000-4000-8000-000000000010",
      productVariantId: "00000000-0000-4000-8000-000000000020",
      quantity: 3,
    };

    await assert.rejects(
      reserveInventoryForLine({
        trx: {},
        line,
        now: new Date().toISOString(),
        loadVariant: async () => ({
          inventory_sku_id: "00000000-0000-4000-8000-000000000999",
          product_is_active: true,
          is_listed: true,
          sku_is_active: true,
          stock: 2,
          selling_price_cents: 1500,
        }),
        decrementInventory: async () => {
          throw new Error("should_not_run_when_stock_insufficient");
        },
      }),
      (err) => err?.code === "OUT_OF_STOCK"
    );
  });

  test("reserves stock via inventory_sku_id and not variant stock mutation", async () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { reserveInventoryForLine } = routeModule.__test;

    const line = {
      productId: "00000000-0000-4000-8000-000000000010",
      productVariantId: "00000000-0000-4000-8000-000000000020",
      quantity: 2,
    };
    let receivedArgs = null;

    const variant = await reserveInventoryForLine({
      trx: {},
      line,
      now: new Date().toISOString(),
      loadVariant: async () => ({
        inventory_sku_id: "00000000-0000-4000-8000-000000000999",
        product_is_active: true,
        is_listed: true,
        sku_is_active: true,
        stock: 10,
        selling_price_cents: 2100,
      }),
      decrementInventory: async (args) => {
        receivedArgs = args;
        return 1;
      },
    });

    assert.ok(variant);
    assert.equal(receivedArgs.inventorySkuId, "00000000-0000-4000-8000-000000000999");
    assert.equal(receivedArgs.quantity, 2);
    assert.equal("productVariantId" in receivedArgs, false);
  });

  test("checkout economics derives our_share_cents when omitted", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { normalizeVariantEconomicsForCheckout } = routeModule.__test;

    const normalized = normalizeVariantEconomicsForCheckout({
      selling_price_cents: 2100,
      vendor_payout_cents: 700,
      royalty_cents: 300,
      our_share_cents: null,
    });

    assert.equal(normalized.error, null);
    assert.equal(normalized.value.our_share_cents, 1100);
  });

  test("throws out_of_stock when inventory decrement race loses", async () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { reserveInventoryForLine } = routeModule.__test;

    const line = {
      productId: "00000000-0000-4000-8000-000000000010",
      productVariantId: "00000000-0000-4000-8000-000000000020",
      quantity: 1,
    };

    await assert.rejects(
      reserveInventoryForLine({
        trx: {},
        line,
        now: new Date().toISOString(),
        loadVariant: async () => ({
          inventory_sku_id: "00000000-0000-4000-8000-000000000999",
          product_is_active: true,
          is_listed: true,
          sku_is_active: true,
          stock: 5,
          selling_price_cents: 999,
        }),
        decrementInventory: async () => 0,
      }),
      (err) => err?.code === "OUT_OF_STOCK"
    );
  });
});
