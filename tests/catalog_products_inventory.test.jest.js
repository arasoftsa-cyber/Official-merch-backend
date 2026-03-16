const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { silenceTestLogs } = require("./helpers/logging");

const CATALOG_SERVICE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/services/catalog.service.js"
);
const CATALOG_CONTROLLER_MODULE_PATH = path.resolve(
  __dirname,
  "../src/controllers/catalog.controller.js"
);
const ORDERS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/orders.routes.js"
);
const PRODUCT_VARIANTS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/productVariants.routes.js"
);
const VARIANT_AVAILABILITY_MODULE_PATH = path.resolve(
  __dirname,
  "../src/services/variantAvailability.service.js"
);
const CATALOG_ROUTES_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/catalog.routes.js"
);
const PRODUCT_VARIANTS_ROUTES_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/productVariants.routes.js"
);
const DB_MODULE_PATH = path.resolve(__dirname, "../src/core/db/db.js");
const AUTH_MIDDLEWARE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/core/http/auth.middleware.js"
);
const POLICY_MIDDLEWARE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/core/http/policy.middleware.js"
);

const mockFile = (name, mimetype = "image/png") => ({
  originalname: name,
  mimetype,
  buffer: Buffer.from("x"),
});

const mkUuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const tableNameFrom = (raw) => String(raw || "").split(/\s+as\s+/i)[0].trim();
const keyFrom = (value) => String(value || "").split(".").pop().replace(/"/g, "");

const parseAlias = (value) => {
  const text = String(value || "");
  const match = text.match(/^(.+?)\s+as\s+("?[\w]+"?)$/i);
  if (!match) return { source: keyFrom(text), alias: keyFrom(text) };
  return { source: keyFrom(match[1]), alias: keyFrom(match[2]) };
};

const pickColumns = (row, cols = []) => {
  if (!row) return null;
  const flat = (Array.isArray(cols) ? cols : [cols]).flat();
  if (!flat.length) return { ...row };
  const out = {};
  for (const col of flat) {
    if (typeof col !== "string") continue;
    if (col.endsWith(".*")) {
      Object.assign(out, row);
      continue;
    }
    const { source, alias } = parseAlias(col);
    out[alias] = row[source];
  }
  return out;
};

const createCatalogRuntimeState = () => ({
  seq: 500,
  artists: [
    {
      id: mkUuid(101),
      name: "Runtime Artist",
      created_at: "2026-03-08T00:00:00.000Z",
    },
  ],
  products: [],
  product_variants: [],
  inventory_skus: [],
});

const createVariantRows = (state, { productId } = {}) => {
  const rows = state.product_variants
    .filter((variant) => !productId || variant.product_id === productId)
    .map((variant) => {
      const sku = state.inventory_skus.find((row) => row.id === variant.inventory_sku_id) || {};
      const product = state.products.find((row) => row.id === variant.product_id) || {};
      const stock = Number(sku.stock ?? variant.stock ?? 0);
      const listed = variant.is_listed !== false;
      const skuActive = sku.is_active !== false;
      const productActive = product.is_active !== false;
      const price = Number(
        variant.selling_price_cents ?? variant.price_cents ?? variant.priceCents ?? 0
      );
      return {
        id: variant.id,
        product_id: variant.product_id,
        sku: variant.sku,
        size: variant.size || sku.size || "default",
        color: variant.color || sku.color || "default",
        inventory_sku_id: variant.inventory_sku_id,
        supplier_sku: sku.supplier_sku || null,
        merch_type: sku.merch_type || null,
        quality_tier: sku.quality_tier || null,
        stock,
        sku_is_active: skuActive,
        variant_is_listed: listed,
        effective_is_active: Boolean(productActive && listed && skuActive),
        effective_sellable: Boolean(productActive && listed && skuActive && stock > 0),
        price_cents: price,
        selling_price_cents: price,
        vendor_payout_cents: variant.vendor_payout_cents ?? null,
        royalty_cents: variant.royalty_cents ?? null,
        our_share_cents: variant.our_share_cents ?? null,
        created_at: variant.created_at || "2026-03-08T00:00:00.000Z",
      };
    });
  return rows;
};

const createVariantInventoryQuery = (state, { productId } = {}) => {
  const ctx = {
    whereObj: {},
    whereRules: [],
    order: [],
  };

  const execute = () => {
    let rows = createVariantRows(state, { productId });
    rows = rows.filter((row) => {
      const matchesObj = Object.entries(ctx.whereObj).every(([key, value]) => row[keyFrom(key)] === value);
      if (!matchesObj) return false;
      return ctx.whereRules.every((rule) => {
        const current = row[keyFrom(rule.column)];
        if (rule.op === "=") return current === rule.value;
        if (rule.op === ">") return current > rule.value;
        if (rule.op === "<=") return current <= rule.value;
        return false;
      });
    });
    if (ctx.order.length) {
      rows = rows.slice().sort((a, b) => {
        for (const order of ctx.order) {
          const left = a[keyFrom(order.column)];
          const right = b[keyFrom(order.column)];
          if (left === right) continue;
          const factor = order.direction === "asc" ? 1 : -1;
          return left > right ? factor : -factor;
        }
        return 0;
      });
    }
    return rows;
  };

  const query = {
    where(arg1, arg2, arg3) {
      if (arg1 && typeof arg1 === "object" && arg2 === undefined) {
        ctx.whereObj = { ...ctx.whereObj, ...(arg1 || {}) };
        return query;
      }
      if (arg3 === undefined) {
        ctx.whereRules.push({ column: arg1, op: "=", value: arg2 });
      } else {
        ctx.whereRules.push({ column: arg1, op: String(arg2 || "="), value: arg3 });
      }
      return query;
    },
    orderBy(column, direction = "asc") {
      ctx.order.push({ column, direction: String(direction).toLowerCase() === "asc" ? "asc" : "desc" });
      return query;
    },
    async first() {
      return execute()[0] || null;
    },
    then(resolve, reject) {
      try {
        resolve(execute());
      } catch (error) {
        if (reject) reject(error);
        else throw error;
      }
    },
  };
  return query;
};

const createCatalogRuntimeDb = (state) => {
  const columnInfoByTable = {
    artists: { id: {}, name: {}, created_at: {} },
    products: {
      id: {},
      artist_id: {},
      title: {},
      description: {},
      is_active: {},
      status: {},
      rejection_reason: {},
      merch_story: {},
      merch_type: {},
      colors: {},
      mrp_cents: {},
      selling_price_cents: {},
      vendor_payout_cents: {},
      our_share_cents: {},
      royalty_cents: {},
      listing_photos: {},
      sku_types: {},
      created_at: {},
      updated_at: {},
    },
    product_variants: {
      id: {},
      product_id: {},
      inventory_sku_id: {},
      sku: {},
      size: {},
      color: {},
      price_cents: {},
      selling_price_cents: {},
      vendor_payout_cents: {},
      royalty_cents: {},
      our_share_cents: {},
      is_listed: {},
      stock: {},
      created_at: {},
      updated_at: {},
    },
    inventory_skus: {
      id: {},
      supplier_sku: {},
      merch_type: {},
      quality_tier: {},
      size: {},
      color: {},
      stock: {},
      is_active: {},
      supplier_cost_cents: {},
      mrp_cents: {},
      metadata: {},
      created_at: {},
      updated_at: {},
    },
  };

  const toStoreValue = (value) => {
    if (value && typeof value === "object" && value.__rawJsonValue !== undefined) {
      return value.__rawJsonValue;
    }
    return value;
  };

  const getRowsFor = (table) => {
    if (table === "artists") return state.artists;
    if (table === "products") return state.products;
    if (table === "product_variants") return state.product_variants;
    if (table === "inventory_skus") return state.inventory_skus;
    return [];
  };

  const db = (rawTableName) => {
    const table = tableNameFrom(rawTableName);
    const ctx = {
      selectCols: [],
      whereObj: {},
      whereRules: [],
      whereInRules: [],
      order: [],
      limit: null,
      offset: 0,
    };

    const execute = () => {
      let rows = getRowsFor(table).map((row) => ({ ...row }));

      if (table === "products") {
        rows = rows.map((row) => {
          const variants = createVariantRows(state, { productId: row.id }).filter(
            (variant) => variant.effective_sellable
          );
          const prices = variants.map((variant) => Number(variant.selling_price_cents)).filter(Number.isFinite);
          const minPrice = prices.length ? Math.min(...prices) : null;
          return { ...row, priceCents: minPrice, minVariantPriceCents: minPrice };
        });
      }

      rows = rows.filter((row) => {
        const matchesObj = Object.entries(ctx.whereObj).every(
          ([key, value]) => row[keyFrom(key)] === value
        );
        if (!matchesObj) return false;
        const matchesRules = ctx.whereRules.every((rule) => {
          const current = row[keyFrom(rule.column)];
          if (rule.op === "=") return current === rule.value;
          if (rule.op === ">") return current > rule.value;
          if (rule.op === "<=") return current <= rule.value;
          return false;
        });
        if (!matchesRules) return false;
        return ctx.whereInRules.every((rule) => {
          const current = row[keyFrom(rule.column)];
          return rule.values.includes(current);
        });
      });

      if (ctx.order.length) {
        rows = rows.slice().sort((a, b) => {
          for (const order of ctx.order) {
            const left = a[keyFrom(order.column)];
            const right = b[keyFrom(order.column)];
            if (left === right) continue;
            const factor = order.direction === "asc" ? 1 : -1;
            return left > right ? factor : -factor;
          }
          return 0;
        });
      }

      if (ctx.offset > 0) rows = rows.slice(ctx.offset);
      if (typeof ctx.limit === "number") rows = rows.slice(0, ctx.limit);
      if (!ctx.selectCols.length) return rows;
      return rows.map((row) => pickColumns(row, ctx.selectCols));
    };

    const query = {
      select(...cols) {
        ctx.selectCols.push(...cols.flat());
        return query;
      },
      where(arg1, arg2, arg3) {
        if (arg1 && typeof arg1 === "object" && arg2 === undefined) {
          ctx.whereObj = { ...ctx.whereObj, ...(arg1 || {}) };
          return query;
        }
        if (arg3 === undefined) {
          ctx.whereRules.push({ column: arg1, op: "=", value: arg2 });
        } else {
          ctx.whereRules.push({ column: arg1, op: String(arg2 || "="), value: arg3 });
        }
        return query;
      },
      andWhere(arg1, arg2, arg3) {
        return query.where(arg1, arg2, arg3);
      },
      whereIn(column, values) {
        ctx.whereInRules.push({ column, values: Array.isArray(values) ? values.slice() : [] });
        return query;
      },
      whereRaw() {
        return query;
      },
      whereExists() {
        return query;
      },
      orderBy(column, direction = "asc") {
        ctx.order.push({ column, direction: String(direction).toLowerCase() === "asc" ? "asc" : "desc" });
        return query;
      },
      limit(value) {
        ctx.limit = Number(value);
        return query;
      },
      offset(value) {
        ctx.offset = Number(value) || 0;
        return query;
      },
      leftJoin() {
        return query;
      },
      join() {
        return query;
      },
      groupBy() {
        return query;
      },
      async first(...cols) {
        const row = execute()[0] || null;
        if (!row) return null;
        return cols.length ? pickColumns(row, cols) : row;
      },
      async columnInfo() {
        return columnInfoByTable[table] || {};
      },
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        const target = getRowsFor(table);
        const inserted = rows.map((row) => {
          const next = {};
          for (const [key, value] of Object.entries(row || {})) {
            next[key] = toStoreValue(value);
          }
          if (!next.id) {
            state.seq += 1;
            next.id = mkUuid(state.seq);
          }
          if (!next.created_at) next.created_at = "2026-03-08T00:00:00.000Z";
          if (!next.updated_at) next.updated_at = next.created_at;
          target.push(next);
          return { ...next };
        });
        return {
          returning: async (cols) => inserted.map((row) => pickColumns(row, cols || [])),
          onConflict: () => ({
            ignore: async () => inserted.length,
            merge: async (patch = {}) => {
              for (const row of inserted) {
                const index = target.findIndex((item) => item.id === row.id);
                if (index >= 0) {
                  target[index] = { ...target[index], ...patch };
                }
              }
              return inserted.length;
            },
          }),
        };
      },
      async update(patch) {
        const rows = execute();
        const ids = new Set(rows.map((row) => row.id));
        const target = getRowsFor(table);
        let updated = 0;
        for (let i = 0; i < target.length; i += 1) {
          if (!ids.has(target[i].id)) continue;
          const nextPatch = {};
          for (const [key, value] of Object.entries(patch || {})) {
            nextPatch[key] = toStoreValue(value);
          }
          target[i] = { ...target[i], ...nextPatch };
          updated += 1;
        }
        return updated;
      },
      async del() {
        const rows = execute();
        const ids = new Set(rows.map((row) => row.id));
        const target = getRowsFor(table);
        const kept = target.filter((row) => !ids.has(row.id));
        const removed = target.length - kept.length;
        target.splice(0, target.length, ...kept);
        return removed;
      },
      delete() {
        return query.del();
      },
      then(resolve, reject) {
        try {
          resolve(execute());
        } catch (error) {
          if (reject) reject(error);
          else throw error;
        }
      },
    };
    return query;
  };

  db.__state = state;
  db.fn = {
    now: () => "2026-03-08T00:00:00.000Z",
  };
  db.raw = (_sql, bindings = []) => {
    const first = Array.isArray(bindings) ? bindings[0] : undefined;
    if (typeof first === "string") {
      try {
        return { __rawJsonValue: JSON.parse(first) };
      } catch (_error) {
        return { __rawJsonValue: first };
      }
    }
    return { __rawJsonValue: first };
  };
  db.schema = {
    hasTable: async (tableName) => {
      const table = String(tableName || "").trim();
      if (table === "entity_media_links" || table === "media_assets") return false;
      return Object.prototype.hasOwnProperty.call(columnInfoByTable, table);
    },
    hasColumn: async (tableName, columnName) =>
      Object.prototype.hasOwnProperty.call(columnInfoByTable[String(tableName || "").trim()] || {}, String(columnName || "").trim()),
  };
  db.transaction = async (handler) => {
    const trx = (tableName) => db(tableName);
    trx.__state = state;
    trx.fn = db.fn;
    trx.raw = db.raw;
    trx.schema = db.schema;
    return handler(trx);
  };
  return db;
};

const seedCatalogProduct = (state, { title = "Seed Product", priceCents = 2199, stock = 7 } = {}) => {
  state.seq += 1;
  const productId = mkUuid(state.seq);
  state.seq += 1;
  const inventorySkuId = mkUuid(state.seq);
  state.seq += 1;
  const variantId = mkUuid(state.seq);

  state.products.push({
    id: productId,
    artist_id: state.artists[0].id,
    title,
    description: "Runtime seeded product",
    is_active: true,
    status: "active",
    created_at: "2026-03-08T00:00:00.000Z",
    updated_at: "2026-03-08T00:00:00.000Z",
  });
  state.inventory_skus.push({
    id: inventorySkuId,
    supplier_sku: `SEED-${String(productId).slice(-6)}`,
    merch_type: "default",
    quality_tier: null,
    size: "M",
    color: "Black",
    stock,
    is_active: true,
    metadata: {},
    created_at: "2026-03-08T00:00:00.000Z",
    updated_at: "2026-03-08T00:00:00.000Z",
  });
  state.product_variants.push({
    id: variantId,
    product_id: productId,
    inventory_sku_id: inventorySkuId,
    sku: `SKU-${String(productId).slice(-6)}`,
    size: "M",
    color: "Black",
    price_cents: priceCents,
    selling_price_cents: priceCents,
    is_listed: true,
    stock,
    created_at: "2026-03-08T00:00:00.000Z",
    updated_at: "2026-03-08T00:00:00.000Z",
  });
  return { productId, variantId, inventorySkuId };
};

const createCatalogRuntimeApi = () => {
  jest.resetModules();
  const state = createCatalogRuntimeState();
  const db = createCatalogRuntimeDb(state);

  const dbMockFactory = () => ({ getDb: () => db });
  jest.doMock(DB_MODULE_PATH, dbMockFactory);
  jest.doMock("../src/core/db/db", dbMockFactory);
  jest.doMock("../src/core/db/db.js", dbMockFactory);

  jest.doMock(AUTH_MIDDLEWARE_MODULE_PATH, () => ({
    requireAuth: (req, res, next) => {
      const userId = String(req.headers["x-test-user-id"] || "").trim();
      const role = String(req.headers["x-test-role"] || "").trim();
      if (!userId || !role) {
        return res.status(401).json({ error: "unauthorized" });
      }
      req.user = { id: userId, role };
      return next();
    },
    attachAuthUser: (req, _res, next) => {
      const userId = String(req.headers["x-test-user-id"] || "").trim();
      const role = String(req.headers["x-test-role"] || "").trim();
      if (userId && role) req.user = { id: userId, role };
      return next();
    },
  }));

  jest.doMock(POLICY_MIDDLEWARE_MODULE_PATH, () => ({
    requirePolicy: () => (_req, _res, next) => next(),
  }));

  jest.doMock(VARIANT_AVAILABILITY_MODULE_PATH, () => {
    const actual = jest.requireActual(VARIANT_AVAILABILITY_MODULE_PATH);
    return {
      ...actual,
      buildSellableMinPriceSubquery: () => ({
        wrap: (_left, right) => {
          const aliasMatch = String(right || "").match(/as\s+("?[\w]+"?)/i);
          return aliasMatch ? aliasMatch[1] : "\"priceCents\"";
        },
      }),
      applySellableVariantExists: (query) => query,
      buildVariantInventoryQuery: (dbRef, { productId } = {}) =>
        createVariantInventoryQuery(dbRef.__state || state, { productId }),
    };
  });

  const catalogRoutes = require(CATALOG_ROUTES_MODULE_PATH);
  const productVariantsRoutes = require(PRODUCT_VARIANTS_ROUTES_MODULE_PATH);
  const app = express();
  app.use(express.json());
  app.use("/api", catalogRoutes);
  app.use("/api", productVariantsRoutes);
  return { app, state };
};

describe("catalog products and inventory", () => {
  it("normalizeSkuTypes parses and dedupes supported sku types", () => {
    const { normalizeSkuTypes } = require(CATALOG_SERVICE_MODULE_PATH);
    const result = normalizeSkuTypes(
      JSON.stringify(["regular_tshirt", "hoodie", "regular_tshirt"])
    );

    expect(result.invalid).toEqual([]);
    expect(result.skuTypes).toEqual(["regular_tshirt", "hoodie"]);
  });

  it("normalizeSkuTypes reports unsupported sku types", () => {
    const { normalizeSkuTypes } = require(CATALOG_SERVICE_MODULE_PATH);
    const result = normalizeSkuTypes(["hoodie", "cap"]);

    expect(result.skuTypes).toEqual(["hoodie"]);
    expect(result.invalid).toEqual(["cap"]);
  });

  it("parseOnboardingSkuTypes requires at least one supported sku type", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);
    const result = __test.parseOnboardingSkuTypes({ sku_types: "[]" });

    expect(result.ok).toBe(false);
    expect(result.details[0].field).toBe("sku_types");
  });

  it("parseOnboardingSkuTypes accepts comma-separated values", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);
    const result = __test.parseOnboardingSkuTypes({
      sku_types: "regular_tshirt, oversized_hoodie",
    });

    expect(result.ok).toBe(true);
    expect(result.skuTypes).toEqual(["regular_tshirt", "oversized_hoodie"]);
  });

  it("validateDesignImageFile requires one image and rejects multiples", () => {
    const { validateDesignImageFile } = require(CATALOG_SERVICE_MODULE_PATH);
    const missing = validateDesignImageFile({}, { required: true });
    const multiple = validateDesignImageFile(
      { design_image: [mockFile("a.png"), mockFile("b.png")] },
      { required: true }
    );

    expect(missing.ok).toBe(false);
    expect(multiple.ok).toBe(false);
  });

  it("validateDesignImageFile accepts png/jpg/jpeg/svg and rejects unsupported types", () => {
    const { validateDesignImageFile } = require(CATALOG_SERVICE_MODULE_PATH);
    const png = validateDesignImageFile({ design_image: mockFile("a.png", "image/png") }, { required: true });
    const jpg = validateDesignImageFile({ design_image: mockFile("a.jpg", "image/jpeg") }, { required: true });
    const svg = validateDesignImageFile({ design_image: mockFile("a.svg", "image/svg+xml") }, { required: true });
    const bad = validateDesignImageFile({ design_image: mockFile("a.gif", "image/gif") }, { required: true });

    expect(png.ok).toBe(true);
    expect(jpg.ok).toBe(true);
    expect(svg.ok).toBe(true);
    expect(bad.ok).toBe(false);
    expect(bad.details[0].field).toBe("design_image");
  });

  it("validateListingPhotoFiles supports 4..6 listing images for approval flow", () => {
    const { validateListingPhotoFiles } = require(CATALOG_SERVICE_MODULE_PATH);
    const fiveFiles = validateListingPhotoFiles(
      {
        listing_photos: [
          mockFile("1.png"),
          mockFile("2.png"),
          mockFile("3.png"),
          mockFile("4.png"),
          mockFile("5.png"),
        ],
      },
      { required: true, minFiles: 4, maxFiles: 6, maxIndexedField: 6 }
    );
    const sevenFiles = validateListingPhotoFiles(
      {
        listing_photos: [
          mockFile("1.png"),
          mockFile("2.png"),
          mockFile("3.png"),
          mockFile("4.png"),
          mockFile("5.png"),
          mockFile("6.png"),
          mockFile("7.png"),
        ],
      },
      { required: true, minFiles: 4, maxFiles: 6, maxIndexedField: 6 }
    );

    expect(fiveFiles.ok).toBe(true);
    expect(sevenFiles.ok).toBe(false);
  });

  it("validateListingPhotoFiles keeps exact-4 behavior by default", () => {
    const { validateListingPhotoFiles } = require(CATALOG_SERVICE_MODULE_PATH);
    const fourFiles = validateListingPhotoFiles(
      {
        listing_photo_1: mockFile("1.png"),
        listing_photo_2: mockFile("2.png"),
        listing_photo_3: mockFile("3.png"),
        listing_photo_4: mockFile("4.png"),
      },
      { required: true }
    );
    const fiveFiles = validateListingPhotoFiles(
      {
        listing_photos: [
          mockFile("1.png"),
          mockFile("2.png"),
          mockFile("3.png"),
          mockFile("4.png"),
          mockFile("5.png"),
        ],
      },
      { required: true }
    );

    expect(fourFiles.ok).toBe(true);
    expect(fiveFiles.ok).toBe(false);
  });

  it("artist status toggle guard allows only active/inactive on approved merch", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);

    expect(__test.canArtistToggleProductStatus("active", "inactive")).toBe(true);
    expect(__test.canArtistToggleProductStatus("inactive", "active")).toBe(true);
    expect(__test.canArtistToggleProductStatus("pending", "active")).toBe(false);
    expect(__test.canArtistToggleProductStatus("active", "rejected")).toBe(false);
    expect(__test.canArtistToggleProductStatus("inactive", "pending")).toBe(false);
    expect(__test.canArtistToggleProductStatus("rejected", "active")).toBe(false);
  });

  it("admin patch status guard allows only active/inactive for already approved merch", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);

    expect(__test.canAdminPatchProductStatus("active", "inactive")).toBe(true);
    expect(__test.canAdminPatchProductStatus("inactive", "active")).toBe(true);
    expect(__test.canAdminPatchProductStatus("pending", "inactive")).toBe(false);
    expect(__test.canAdminPatchProductStatus("pending", "rejected")).toBe(false);
    expect(__test.canAdminPatchProductStatus("rejected", "active")).toBe(false);
  });

  it("status normalization falls back to is_active when status is missing", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);
    expect(__test.normalizeProductStatusFromRecord({ status: "pending", is_active: true })).toBe(
      "pending"
    );
    expect(__test.normalizeProductStatusFromRecord({ is_active: false })).toBe("inactive");
    expect(__test.normalizeProductStatusFromRecord({ is_active: true })).toBe("active");
  });

  it("new merch validation returns canonical economics fields", () => {
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

    expect(validation.ok).toBe(true);
    expect(validation.value.sellingPriceCents).toBe(2400);
    expect(validation.value.vendorPayoutCents).toBe(900);
    expect(validation.value.royaltyCents).toBe(300);
    expect(validation.value.ourShareCents).toBe(1200);
    expect("vendorPayCents" in validation.value).toBe(false);
  });

  it("new merch validation derives selling price from legacy split fields", () => {
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

    expect(validation.ok).toBe(true);
    expect(validation.value.sellingPriceCents).toBe(1999);
    expect(validation.value.vendorPayoutCents).toBe(800);
    expect(validation.value.royaltyCents).toBe(499);
    expect(validation.value.ourShareCents).toBe(700);
  });

  it("new merch validation allows parent create without explicit sell price", () => {
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

    expect(validation.ok).toBe(true);
    expect(validation.value.sellingPriceCents).toBe(null);
  });

  it("variant normalization derives our_share_cents from selling/vendor/royalty", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      inventory_sku_id: "00000000-0000-4000-8000-000000000999",
      selling_price_cents: 2500,
      vendor_payout_cents: 1000,
      royalty_cents: 250,
    });

    expect(normalized.error).toBe(undefined);
    expect(normalized.value.our_share_cents).toBe(1250);
  });

  it("variant normalization preserves explicit sku, size, and color", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      inventory_sku_id: "00000000-0000-4000-8000-000000000999",
      sku: "RACE-123",
      size: "M",
      color: "Race",
      selling_price_cents: 999,
    });

    expect(normalized.error).toBe(undefined);
    expect(normalized.value.sku).toBe("RACE-123");
    expect(normalized.value.size).toBe("M");
    expect(normalized.value.color).toBe("Race");
  });

  it("variant normalization defaults size/color only when missing", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      inventory_sku_id: "00000000-0000-4000-8000-000000000999",
      selling_price_cents: 999,
    });

    expect(normalized.error).toBe(undefined);
    expect(normalized.value.size).toBe("default");
    expect(normalized.value.color).toBe("default");
  });

  it("variant normalization rejects invalid negative derived our_share_cents", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      inventory_sku_id: "00000000-0000-4000-8000-000000000999",
      selling_price_cents: 1200,
      vendor_payout_cents: 1000,
      royalty_cents: 500,
    });

    expect(normalized.error).toBe("invalid_our_share_cents");
  });

  it("variant normalization rejects removed price aliases", () => {
    const { normalizeVariant } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;
    const normalized = normalizeVariant({
      id: "00000000-0000-4000-8000-000000000001",
      priceCents: 2100,
      stock: 12,
    });

    expect(normalized.error).toBe(undefined);
    expect(normalized.value.selling_price_cents).toBe(undefined);
    expect(normalized.value.stock).toBe(12);
  });

  it("listed variants require a positive sell price", () => {
    const { validateListedVariantPrice } = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH).__test;

    expect(validateListedVariantPrice({ isListed: true, sellingPriceCents: 0 })).toBe(false);
    expect(validateListedVariantPrice({ isListed: true, sellingPriceCents: 1999 })).toBe(true);
    expect(validateListedVariantPrice({ isListed: false, sellingPriceCents: 0 })).toBe(true);
  });

  it("inactive SKU makes variant effectively unavailable", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { isVariantEffectivelySellable } = routeModule.__test;

    const sellable = isVariantEffectivelySellable({
      product_is_active: true,
      is_listed: true,
      sku_is_active: false,
      stock: 10,
    });

    expect(sellable).toBe(false);
  });

  it("zero stock SKU makes variant unsellable", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { isVariantEffectivelySellable } = routeModule.__test;

    const sellable = isVariantEffectivelySellable({
      product_is_active: true,
      is_listed: true,
      sku_is_active: true,
      stock: 0,
    });

    expect(sellable).toBe(false);
  });

  it("listed=false variant remains unavailable even with active in-stock SKU", () => {
    const routeModule = require(ORDERS_ROUTE_MODULE_PATH);
    const { isVariantEffectivelySellable } = routeModule.__test;

    const sellable = isVariantEffectivelySellable({
      product_is_active: true,
      is_listed: false,
      sku_is_active: true,
      stock: 50,
    });

    expect(sellable).toBe(false);
  });

  it("duplicate (product, inventory_sku) mapping is rejected by helper", () => {
    const routeModule = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH);
    const { validateUniqueInventorySkuMappings } = routeModule.__test;

    const isUnique = validateUniqueInventorySkuMappings([
      { id: "v1", inventory_sku_id: "00000000-0000-4000-8000-000000000111" },
      { id: "v2", inventory_sku_id: "00000000-0000-4000-8000-000000000111" },
    ]);

    expect(isUnique).toBe(false);
  });

  it("variant serializer keeps canonical and legacy aliases for readback compatibility", () => {
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

    expect(variant.id).toBe("00000000-0000-4000-8000-000000000111");
    expect(variant.product_id).toBe("00000000-0000-4000-8000-000000000222");
    expect(variant.productId).toBe("00000000-0000-4000-8000-000000000222");
    expect(variant.inventory_sku_id).toBe("00000000-0000-4000-8000-000000000333");
    expect(variant.inventorySkuId).toBe("00000000-0000-4000-8000-000000000333");
    expect(variant.supplier_sku).toBe("LEGACY-RACE-M");
    expect(variant.supplierSku).toBe("LEGACY-RACE-M");
    expect(variant.price_cents).toBe(999);
    expect(variant.priceCents).toBe(999);
    expect(variant.selling_price_cents).toBe(999);
    expect(variant.sellingPriceCents).toBe(999);
    expect(variant.stock).toBe(1);
    expect(variant.effective_is_active).toBe(true);
    expect(variant.effectiveIsActive).toBe(true);
    expect(variant.effective_sellable).toBe(true);
    expect(variant.effectiveSellable).toBe(true);
  });

  it("touched variants are ordered first in variant upsert responses", () => {
    const routeModule = require(PRODUCT_VARIANTS_ROUTE_MODULE_PATH);
    const { orderVariantsByTouchedIds } = routeModule.__test;

    const ordered = orderVariantsByTouchedIds(
      [
        { id: "default-variant", sku: "DEFAULT" },
        { id: "race-variant", sku: "RACE-1" },
      ],
      ["race-variant"]
    );

    expect(ordered[0].id).toBe("race-variant");
    expect(ordered[1].id).toBe("default-variant");
  });
});

describe("catalog runtime api contracts", () => {
  let restoreLogs = () => {};

  beforeAll(() => {
    restoreLogs = silenceTestLogs(["log", "warn"]);
  });

  afterAll(() => {
    restoreLogs();
  });

  afterEach(() => {
    jest.resetModules();
  });

  it("GET /api/products and GET /api/products/:id return runtime contract payloads", async () => {
    const { app, state } = createCatalogRuntimeApi();
    const { productId, variantId } = seedCatalogProduct(state, {
      title: "Runtime Public Tee",
      priceCents: 2299,
      stock: 8,
    });

    const listRes = await request(app).get("/api/products");
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body?.items)).toBe(true);
    const listed = listRes.body.items.find(
      (item) => item?.id === productId || item?.productId === productId
    );
    expect(Boolean(listed)).toBe(true);
    expect(typeof listed.title).toBe("string");
    expect(typeof listed.artistId).toBe("string");
    expect(typeof listed.status).toBe("string");
    expect(typeof listed.priceCents === "number" || listed.priceCents === null).toBe(true);
    expect(Array.isArray(listed.listingPhotoUrls || listed.photoUrls || [])).toBe(true);

    const detailRes = await request(app).get(`/api/products/${productId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body?.product?.id).toBe(productId);
    expect(typeof detailRes.body?.product?.title).toBe("string");
    expect(Array.isArray(detailRes.body?.variants)).toBe(true);
    expect(detailRes.body.variants.some((variant) => variant.id === variantId)).toBe(true);
    expect(Array.isArray(detailRes.body?.photos || detailRes.body?.product?.photos || [])).toBe(
      true
    );
  });

  it("admin multipart create and persisted variant readback work on real API routes", async () => {
    const { app, state } = createCatalogRuntimeApi();
    const adminHeaders = {
      "x-test-user-id": "admin-runtime-user",
      "x-test-role": "admin",
    };
    const artistHeaders = {
      "x-test-user-id": "artist-runtime-user",
      "x-test-role": "artist",
    };
    const artistId = state.artists[0].id;

    const forbiddenCreate = await request(app)
      .post("/api/admin/products")
      .set(artistHeaders)
      .field("title", "Forbidden Artist Create")
      .field("artistId", artistId)
      .field("priceCents", "1999");
    expect(forbiddenCreate.status).toBe(403);

    const createRes = await request(app)
      .post("/api/admin/products")
      .set(adminHeaders)
      .field("title", "Runtime Admin Tee")
      .field("description", "multipart runtime create")
      .field("artistId", artistId)
      .field("priceCents", "2499")
      .field("stock", "11")
      .field("size", "M")
      .field("color", "Black");
    expect(createRes.status).toBe(201);
    const productId = createRes.body?.productId || createRes.body?.id;
    expect(typeof productId).toBe("string");
    expect(createRes.body?.product?.id).toBe(productId);
    expect(Array.isArray(createRes.body?.listingPhotoUrls || createRes.body?.photoUrls || [])).toBe(
      true
    );

    const variantsReadRes = await request(app)
      .get(`/api/admin/products/${productId}/variants`)
      .set(adminHeaders);
    expect(variantsReadRes.status).toBe(200);
    const variantsBefore = variantsReadRes.body?.items || variantsReadRes.body?.variants || [];
    expect(Array.isArray(variantsBefore)).toBe(true);
    expect(variantsBefore.length).toBeGreaterThan(0);
    const firstVariant = variantsBefore[0];
    expect(firstVariant?.productId || firstVariant?.product_id).toBe(productId);
    expect(typeof firstVariant?.inventorySkuId || firstVariant?.inventory_sku_id).toBe("string");

    const updateRes = await request(app)
      .put(`/api/admin/products/${productId}/variants`)
      .set(adminHeaders)
      .send({
        variants: [
          {
            id: firstVariant.id,
            inventory_sku_id: firstVariant.inventory_sku_id || firstVariant.inventorySkuId,
            sellingPriceCents: 2699,
            stock: 5,
            size: "M",
            color: "Black",
            isListed: true,
          },
        ],
      });
    expect(updateRes.status).toBe(200);

    const persistedReadRes = await request(app)
      .get(`/api/admin/products/${productId}/variants`)
      .set(adminHeaders);
    expect(persistedReadRes.status).toBe(200);
    const persistedVariants = persistedReadRes.body?.items || persistedReadRes.body?.variants || [];
    const persisted = persistedVariants.find((item) => item.id === firstVariant.id);
    expect(Boolean(persisted)).toBe(true);
    expect(persisted.priceCents).toBe(2699);
    expect(persisted.stock).toBe(5);
    expect(persisted.productId || persisted.product_id).toBe(productId);
  });
});
