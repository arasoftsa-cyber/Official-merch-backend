const { randomUUID } = require("crypto");
const { createProductWithVariants } = require("../../services/catalog.service");

const NODE_ENV = String(process.env.NODE_ENV || "").trim().toLowerCase();
const IS_TEST_OR_DEV = NODE_ENV === "test" || NODE_ENV === "development";
const TEST_SEEDS_ENABLED = process.env.ENABLE_TEST_SEEDS === "true";
const REGISTER_TEST_SEED_ROUTES = IS_TEST_OR_DEV && TEST_SEEDS_ENABLED;
const TEST_BUYER_ID = "00000000-0000-0000-0000-000000000002";
const MAX_SEEDED_ORDERS = 250;

const ensureArtistForSeed = async (db) => {
  let artist = await db("artists").first();
  if (!artist) {
    const id = randomUUID();
    await db("artists").insert({
      id,
      handle: `seed-artist-${id.slice(0, 8)}`,
      name: "Seed Artist",
      theme_json: {},
    });
    artist = { id };
  }
  return artist;
};

const ensureProductVariantForSeed = async (db, artistId, minStock) => {
  let product = await db("products").where({ artist_id: artistId }).first();
  if (!product) {
    const productId = await createProductWithVariants({
      artistId,
      title: "Seed Smoke Product",
      description: "Auto-generated for admin smoke",
      isActive: true,
      variants: [
        {
          sku: `SMOKE-${Date.now()}`,
          size: "OS",
          color: "Black",
          priceCents: 4200,
          stock: minStock,
        },
      ],
    });
    product = { id: productId };
  }
  let variant = await db("product_variants")
    .where({ product_id: product.id })
    .first();
  if (!variant) {
    const [skuRow] = await db("inventory_skus")
      .insert({
        id: randomUUID(),
        supplier_sku: `SMOKE-SKU-${Date.now()}`,
        merch_type: "default",
        quality_tier: null,
        size: "OS",
        color: "Black",
        stock: minStock,
        is_active: true,
        metadata: db.raw("?::jsonb", [JSON.stringify({ source: "admin.seed_orders" })]),
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning(["id"]);
    const variantId = randomUUID();
    await db("product_variants").insert({
      id: variantId,
      product_id: product.id,
      inventory_sku_id: skuRow?.id || null,
      sku: `SMOKE-${Date.now()}`,
      size: "OS",
      color: "Black",
      price_cents: 4200,
      selling_price_cents: 4200,
      is_listed: true,
      stock: minStock,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    variant = await db("product_variants")
      .where({ id: variantId })
      .first();
  }
  const inventorySkuId = variant.inventory_sku_id;
  if (!inventorySkuId) {
    throw new Error("seed_variant_missing_inventory_sku");
  }
  const skuRow = await db("inventory_skus").where({ id: inventorySkuId }).first();
  const desiredStock = Math.max(minStock, Number(skuRow?.stock ?? 0));
  await db("inventory_skus")
    .where({ id: inventorySkuId })
    .update({
      stock: desiredStock + 10,
      is_active: true,
      updated_at: db.fn.now(),
    });
  variant = await db("product_variants").where({ id: variant.id }).first();
  return variant;
};

module.exports = {
  REGISTER_TEST_SEED_ROUTES,
  TEST_SEEDS_ENABLED,
  TEST_BUYER_ID,
  MAX_SEEDED_ORDERS,
  ensureArtistForSeed,
  ensureProductVariantForSeed,
};
