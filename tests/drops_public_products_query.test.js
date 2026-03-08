const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");
const knexFactory = require("knex");

const DROPS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/drops/drops.routes.js"
);
const VARIANT_AVAILABILITY_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/catalog/variantAvailability.js"
);

describe("public drop products query", () => {
  test("uses aggregated drop sort order and safe group-by ordering", () => {
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
    assert.match(sql, /"p"\."status" = \?/);
    assert.match(sql, /min\(dp\.sort_order\) as drop_sort_order/);
    assert.match(sql, /group by .*"p"\."created_at"/);
    assert.match(sql, /order by "drop_sort_order" asc, "p"\."created_at" desc/);
  });

  test("enforces sellable variant existence with active in-stock SKU", () => {
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
    assert.match(sql, /"p"\."status" = \?/);
    assert.match(sql, /exists \(select 1 from "product_variants"/);
    assert.match(sql, /coalesce\(v\.is_listed, true\) = true/);
    assert.match(sql, /sk\.is_active/);
    assert.match(sql, /sk\.stock/);
  });

  test("falls back to is_active filter when status column is unavailable", () => {
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
    assert.match(sql, /"p"\."is_active" = \?/);
  });
});
