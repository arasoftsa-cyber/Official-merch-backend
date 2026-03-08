const { randomUUID } = require("crypto");
const { getDb } = require("../src/core/db/db");
const { hashPassword } = require("../src/utils/password");

const requireEnv = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(
      `seed_smoke_drop_quiz requires environment variable ${name} to be set`
    );
  }
  return value;
};

const SMOKE_ADMIN_EMAIL = requireEnv("SMOKE_ADMIN_EMAIL");
const SMOKE_ADMIN_PASSWORD = requireEnv("SMOKE_ADMIN_PASSWORD");
const SMOKE_ARTIST_HANDLE = "ui-smoke-featured-artist";
const LEGACY_SMOKE_ARTIST_HANDLE = "smoke-artist";
const SMOKE_ARTIST_NAME = "UI Smoke Featured Artist";
const SMOKE_PRODUCT_TITLE = "UI Smoke Featured Product";
const LEGACY_SMOKE_PRODUCT_TITLE = "Seed Artist Tee";
const SMOKE_PRODUCT_DESCRIPTION = "Deterministic product for smoke drop quiz flows";
const SMOKE_VARIANT_SKU = "UI-SMOKE-FEATURED-SKU-1";
const SMOKE_SUPPLIER_SKU = "UI-SMOKE-FEATURED-SUPPLIER-SKU-1";
const SMOKE_DROP_HANDLE = "ui-smoke-featured-drop";
const SMOKE_DROP_TITLE = "UI Smoke Featured Drop";
const SMOKE_DROP_DESCRIPTION = "Deterministic published drop for UI smoke flows";
const SMOKE_DROP_PREFIXES = ["ui-smoke", "smoke"];

const QUIZ_JSON = {
  title: "Smoke Drop Quiz",
  version: 1,
  questions: [
    {
      id: "q1",
      type: "single_choice",
      prompt: "Which shirt color do you want?",
      options: ["Black", "White"],
      required: true,
    },
    {
      id: "q2",
      type: "text",
      prompt: "Tell us your vibe",
      required: false,
    },
  ],
};

const isValidSmokeQuiz = (quiz) => {
  if (!quiz || typeof quiz !== "object") return false;
  if (quiz.title !== QUIZ_JSON.title) return false;
  if (Number(quiz.version) !== QUIZ_JSON.version) return false;
  if (!Array.isArray(quiz.questions) || quiz.questions.length < 2) return false;
  return true;
};

const withSmokeHandlePrefixes = (query, handle = SMOKE_DROP_HANDLE) => {
  const dynamicPrefixes = Array.from(
    new Set(
      [
        ...SMOKE_DROP_PREFIXES,
        String(handle || "")
          .trim()
          .toLowerCase()
          .split("-")
          .slice(0, 2)
          .join("-"),
      ].filter((value) => typeof value === "string" && value.length > 0)
    )
  );

  query.where((qb) => {
    dynamicPrefixes.forEach((prefix, index) => {
      const matcher = `${prefix}%`;
      if (index === 0) {
        qb.whereRaw("lower(handle) like ?", [matcher]);
      } else {
        qb.orWhereRaw("lower(handle) like ?", [matcher]);
      }
    });
  });
};

const resolveCreatedByUser = async (trx, options = {}) => {
  const explicitUserId = String(options.createdByUserId || "").trim();
  if (explicitUserId) {
    const explicitUser = await trx("users").where({ id: explicitUserId }).first("id", "email", "role");
    if (explicitUser?.id) return explicitUser;
  }

  const adminByEmail = await trx("users")
    .whereRaw("lower(email) = ?", [SMOKE_ADMIN_EMAIL.toLowerCase()])
    .first("id", "email", "role");
  if (adminByEmail?.id) return adminByEmail;

  const [createdAdmin] = await trx("users")
    .insert({
      id: randomUUID(),
      email: SMOKE_ADMIN_EMAIL,
      role: "admin",
      password_hash: await hashPassword(SMOKE_ADMIN_PASSWORD),
      created_at: trx.fn.now(),
    })
    .returning(["id", "email", "role"]);
  return createdAdmin;
};

const ensureSmokeArtist = async (trx) => {
  const hasFeaturedFlag = await trx.schema.hasColumn("artists", "is_featured");
  const selectColumns = ["id", "handle", "name"];
  if (hasFeaturedFlag) selectColumns.push("is_featured");

  let artist = await trx("artists")
    .where({ handle: SMOKE_ARTIST_HANDLE })
    .first(selectColumns);

  if (!artist) {
    artist = await trx("artists")
      .where({ handle: LEGACY_SMOKE_ARTIST_HANDLE })
      .first(selectColumns);
  }

  if (!artist) {
    const payload = {
      id: randomUUID(),
      handle: SMOKE_ARTIST_HANDLE,
      name: SMOKE_ARTIST_NAME,
      theme_json: {},
      created_at: trx.fn.now(),
    };
    if (hasFeaturedFlag) payload.is_featured = true;

    const [createdArtist] = await trx("artists")
      .insert(payload)
      .returning(selectColumns);
    return createdArtist;
  }

  const patch = {};
  if (!artist.name) patch.name = SMOKE_ARTIST_NAME;
  if (hasFeaturedFlag && artist.is_featured === false) patch.is_featured = true;
  if (Object.keys(patch).length === 0) return artist;

  const [updatedArtist] = await trx("artists")
    .where({ id: artist.id })
    .update(patch)
    .returning(selectColumns);
  return updatedArtist || artist;
};

const resolveSmokeProduct = async (trx, artistId, options = {}) => {
  const explicitProductId = String(options.productId || "").trim();
  if (explicitProductId) {
    const explicitProduct = await trx("products")
      .where({ id: explicitProductId, artist_id: artistId })
      .first("id", "artist_id", "title", "is_active");
    if (explicitProduct) return explicitProduct;
  }

  let product = await trx("products")
    .where({ artist_id: artistId, title: SMOKE_PRODUCT_TITLE })
    .first("id", "artist_id", "title", "is_active");
  if (product) return product;

  product = await trx("products")
    .where({ artist_id: artistId, title: LEGACY_SMOKE_PRODUCT_TITLE })
    .first("id", "artist_id", "title", "is_active");
  if (product) return product;

  const [createdProduct] = await trx("products")
    .insert({
      id: randomUUID(),
      artist_id: artistId,
      title: SMOKE_PRODUCT_TITLE,
      description: SMOKE_PRODUCT_DESCRIPTION,
      is_active: true,
      created_at: trx.fn.now(),
    })
    .returning(["id", "artist_id", "title", "is_active"]);
  return createdProduct;
};

const ensureSmokeInventorySku = async (trx) => {
  const hasSkuTable = await trx.schema.hasTable("inventory_skus");
  if (!hasSkuTable) return null;

  const skuColumns = await trx("inventory_skus").columnInfo();
  const hasSkuColumn = (name) => Object.prototype.hasOwnProperty.call(skuColumns, name);
  const selectColumns = ["id", "supplier_sku", "stock", "is_active"];
  if (hasSkuColumn("merch_type")) selectColumns.push("merch_type");
  if (hasSkuColumn("size")) selectColumns.push("size");
  if (hasSkuColumn("color")) selectColumns.push("color");

  const existing = await trx("inventory_skus")
    .where({ supplier_sku: SMOKE_SUPPLIER_SKU })
    .first(...selectColumns);

  if (existing) {
    const patch = {
      is_active: true,
      stock: trx.raw("GREATEST(stock, 3)"),
    };
    if (hasSkuColumn("merch_type")) patch.merch_type = "regular_tshirt";
    if (hasSkuColumn("quality_tier")) patch.quality_tier = "standard";
    if (hasSkuColumn("size")) patch.size = "M";
    if (hasSkuColumn("color")) patch.color = "black";
    if (hasSkuColumn("updated_at")) patch.updated_at = trx.fn.now();

    const [updated] = await trx("inventory_skus")
      .where({ id: existing.id })
      .update(patch)
      .returning(selectColumns);
    return updated || existing;
  }

  const payload = {
    id: randomUUID(),
    supplier_sku: SMOKE_SUPPLIER_SKU,
    merch_type: "regular_tshirt",
    quality_tier: "standard",
    size: "M",
    color: "black",
    stock: 3,
    is_active: true,
    created_at: trx.fn.now(),
  };
  if (hasSkuColumn("updated_at")) payload.updated_at = trx.fn.now();
  if (hasSkuColumn("metadata")) {
    payload.metadata = trx.raw("?::jsonb", [JSON.stringify({ source: "seed_smoke_drop_quiz" })]);
  }

  const [created] = await trx("inventory_skus")
    .insert(payload)
    .returning(selectColumns);
  return created || payload;
};

const ensureSmokeVariant = async (trx, productId) => {
  const variantColumns = await trx("product_variants").columnInfo();
  const hasVariantColumn = (name) => Object.prototype.hasOwnProperty.call(variantColumns, name);
  const inventorySku = await ensureSmokeInventorySku(trx);
  if (hasVariantColumn("inventory_sku_id") && !inventorySku?.id) {
    throw new Error("seed_smoke_drop_quiz requires a valid inventory_sku_id mapping");
  }

  const selectColumns = ["id", "product_id", "sku", "size", "color", "price_cents", "stock"];
  if (hasVariantColumn("inventory_sku_id")) selectColumns.push("inventory_sku_id");
  if (hasVariantColumn("selling_price_cents")) selectColumns.push("selling_price_cents");
  if (hasVariantColumn("is_listed")) selectColumns.push("is_listed");

  let variant = await trx("product_variants")
    .where({ sku: SMOKE_VARIANT_SKU })
    .first(...selectColumns);

  if (!variant) {
    variant = await trx("product_variants")
      .where({ product_id: productId })
      .whereRaw("lower(size) = 'm'")
      .whereRaw("lower(color) = 'black'")
      .first(...selectColumns);
  }

  if (!variant) {
    const payload = {
      id: randomUUID(),
      product_id: productId,
      sku: SMOKE_VARIANT_SKU,
      size: "M",
      color: "black",
      price_cents: 400,
      stock: 3,
      created_at: trx.fn.now(),
    };
    if (hasVariantColumn("inventory_sku_id")) payload.inventory_sku_id = inventorySku.id;
    if (hasVariantColumn("selling_price_cents")) payload.selling_price_cents = 400;
    if (hasVariantColumn("is_listed")) payload.is_listed = true;
    if (hasVariantColumn("updated_at")) payload.updated_at = trx.fn.now();

    const [createdVariant] = await trx("product_variants")
      .insert(payload)
      .returning(selectColumns);
    return createdVariant;
  }

  const patch = {
    product_id: productId,
    size: "M",
    color: "black",
    price_cents: 400,
    stock: 3,
  };
  if (hasVariantColumn("inventory_sku_id")) patch.inventory_sku_id = inventorySku.id;
  if (hasVariantColumn("selling_price_cents")) patch.selling_price_cents = 400;
  if (hasVariantColumn("is_listed")) patch.is_listed = true;
  if (hasVariantColumn("updated_at")) patch.updated_at = trx.fn.now();

  const [updatedVariant] = await trx("product_variants")
    .where({ id: variant.id })
    .update(patch)
    .returning(selectColumns);
  return updatedVariant || variant;
};

const repairSmokeDropsWithNullQuiz = async (trx, canonicalDropHandle, artistId) => {
  const rows = await withSmokeHandlePrefixes(
    trx("drops")
      .select("id", "handle", "quiz_json")
      .whereNull("quiz_json"),
    canonicalDropHandle
  );

  const archivedDropIds = [];
  for (const row of rows) {
    if (row.handle === canonicalDropHandle) {
      await trx("drops")
        .where({ id: row.id })
        .update({
          quiz_json: QUIZ_JSON,
          artist_id: artistId,
          label_id: null,
          updated_at: trx.fn.now(),
        });
      continue;
    }

    await trx("drops")
      .where({ id: row.id })
      .update({
        status: "archived",
        updated_at: trx.fn.now(),
      });
    archivedDropIds.push(row.id);
  }

  return archivedDropIds;
};

const ensureSmokeDrop = async (trx, { createdByUserId, artistId, productId, dropHandle }) => {
  await repairSmokeDropsWithNullQuiz(trx, dropHandle, artistId);

  const hasDropFeaturedFlag = await trx.schema.hasColumn("drops", "is_featured");
  let drop = await trx("drops")
    .where({ handle: dropHandle })
    .first("id", "handle", "status", "artist_id", "label_id", "quiz_json");

  if (!drop) {
    const payload = {
      id: randomUUID(),
      handle: dropHandle,
      title: SMOKE_DROP_TITLE,
      description: SMOKE_DROP_DESCRIPTION,
      status: "published",
      artist_id: artistId,
      label_id: null,
      created_by_user_id: createdByUserId,
      quiz_json: QUIZ_JSON,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    };
    if (hasDropFeaturedFlag) payload.is_featured = true;

    const [createdDrop] = await trx("drops")
      .insert(payload)
      .returning(["id", "handle", "status", "artist_id", "label_id", "quiz_json"]);
    drop = createdDrop;
  } else {
    const patch = {
      title: SMOKE_DROP_TITLE,
      description: SMOKE_DROP_DESCRIPTION,
      status: "published",
      artist_id: artistId,
      label_id: null,
      updated_at: trx.fn.now(),
    };
    if (hasDropFeaturedFlag) patch.is_featured = true;
    if (!isValidSmokeQuiz(drop.quiz_json)) {
      patch.quiz_json = QUIZ_JSON;
    }

    const [updatedDrop] = await trx("drops")
      .where({ id: drop.id })
      .update(patch)
      .returning(["id", "handle", "status", "artist_id", "label_id", "quiz_json"]);
    drop = updatedDrop || drop;
  }

  await trx("drop_products")
    .insert({
      drop_id: drop.id,
      product_id: productId,
      sort_order: 0,
      created_at: trx.fn.now(),
    })
    .onConflict(["drop_id", "product_id"])
    .merge({ sort_order: 0 });

  return drop;
};

async function runSeed(db, options = {}) {
  const canonicalDropHandle = String(options.dropHandle || SMOKE_DROP_HANDLE).trim() || SMOKE_DROP_HANDLE;

  return db.transaction(async (trx) => {
    const createdByUser = await resolveCreatedByUser(trx, options);
    if (!createdByUser?.id) {
      throw new Error("seed_smoke_drop_quiz requires a valid created_by_user");
    }

    const artist = await ensureSmokeArtist(trx);
    if (!artist?.id) {
      throw new Error("seed_smoke_drop_quiz requires a valid artist");
    }

    const product = await resolveSmokeProduct(trx, artist.id, options);
    if (!product?.id || product.artist_id !== artist.id) {
      throw new Error("seed_smoke_drop_quiz requires a valid artist-linked product");
    }

    await ensureSmokeVariant(trx, product.id);

    await ensureSmokeDrop(trx, {
      createdByUserId: createdByUser.id,
      artistId: artist.id,
      productId: product.id,
      dropHandle: canonicalDropHandle,
    });

    const verifiedDrop = await trx("drops")
      .select("id", "handle", "status", "artist_id", "quiz_json")
      .where({ handle: canonicalDropHandle })
      .first();
    if (!verifiedDrop) {
      throw new Error(`Smoke drop seed failed: canonical drop '${canonicalDropHandle}' not found`);
    }
    if (!isValidSmokeQuiz(verifiedDrop.quiz_json)) {
      throw new Error(`Smoke drop seed failed: quiz_json invalid for handle '${canonicalDropHandle}'`);
    }
    if (verifiedDrop.artist_id !== artist.id) {
      throw new Error(
        `Smoke drop seed failed: drop artist mismatch for handle '${canonicalDropHandle}' (expected ${artist.id}, got ${verifiedDrop.artist_id || "null"})`
      );
    }

    const linkage = await trx("drop_products")
      .where({ drop_id: verifiedDrop.id, product_id: product.id })
      .first("drop_id");
    if (!linkage) {
      throw new Error(
        `Smoke drop seed failed: drop-product linkage missing (drop=${verifiedDrop.id}, product=${product.id})`
      );
    }

    return {
      drop: verifiedDrop,
      product,
      artist,
      createdByUser,
    };
  });
}

async function main() {
  const db = getDb();
  try {
    const result = await runSeed(db);
    console.log(
      JSON.stringify(
        {
          updatedHandle: result.drop.handle,
          status: result.drop.status,
          hasQuiz: Boolean(result.drop.quiz_json),
          artistHandle: result.artist.handle,
          productId: result.product.id,
          row: result.drop,
        },
        null,
        2
      )
    );
  } finally {
    await db.destroy();
  }
}

module.exports = { runSeed };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
