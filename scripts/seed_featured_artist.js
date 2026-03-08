const { randomUUID } = require("crypto");
const { getDb } = require("../src/core/db/db");
const { hashPassword } = require("../src/utils/password");

const loadSeedConfig = () => {
  const jsonRaw = String(process.env.SMOKE_SEED_USERS_JSON || "").trim();
  let json = {};
  if (jsonRaw) {
    try {
      json = JSON.parse(jsonRaw);
    } catch (error) {
      throw new Error("SMOKE_SEED_USERS_JSON must be valid JSON");
    }
  }

  const pick = (jsonKey, envName) => {
    const fromJson = json[jsonKey];
    if (fromJson !== undefined && fromJson !== null && String(fromJson).trim() !== "") {
      return String(fromJson).trim();
    }
    return String(process.env[envName] || "").trim();
  };

  const cfg = {
    adminEmail: pick("adminEmail", "SMOKE_ADMIN_EMAIL"),
    artistUserId: pick("artistUserId", "SMOKE_ARTIST_USER_ID"),
    labelUserId: pick("labelUserId", "SMOKE_LABEL_USER_ID"),
    artistEmail: pick("artistEmail", "SMOKE_ARTIST_EMAIL"),
    labelEmail: pick("labelEmail", "SMOKE_LABEL_EMAIL"),
    artistPassword: pick("artistPassword", "SMOKE_ARTIST_PASSWORD"),
    labelPassword: pick("labelPassword", "SMOKE_LABEL_PASSWORD"),
    artistHandle: pick("artistHandle", "SMOKE_ARTIST_HANDLE"),
    artistName: pick("artistName", "SMOKE_ARTIST_NAME"),
    labelHandle: pick("labelHandle", "SMOKE_LABEL_HANDLE"),
    labelName: pick("labelName", "SMOKE_LABEL_NAME"),
    productTitle: pick("productTitle", "SMOKE_PRODUCT_TITLE"),
    productDescription: pick("productDescription", "SMOKE_PRODUCT_DESCRIPTION"),
    variantSku: pick("variantSku", "SMOKE_VARIANT_SKU"),
  };

  const required = [
    ["SMOKE_ADMIN_EMAIL", cfg.adminEmail],
    ["SMOKE_ARTIST_USER_ID", cfg.artistUserId],
    ["SMOKE_LABEL_USER_ID", cfg.labelUserId],
    ["SMOKE_ARTIST_EMAIL", cfg.artistEmail],
    ["SMOKE_LABEL_EMAIL", cfg.labelEmail],
    ["SMOKE_ARTIST_PASSWORD", cfg.artistPassword],
    ["SMOKE_LABEL_PASSWORD", cfg.labelPassword],
    ["SMOKE_ARTIST_HANDLE", cfg.artistHandle],
    ["SMOKE_ARTIST_NAME", cfg.artistName],
    ["SMOKE_LABEL_HANDLE", cfg.labelHandle],
    ["SMOKE_LABEL_NAME", cfg.labelName],
    ["SMOKE_PRODUCT_TITLE", cfg.productTitle],
    ["SMOKE_PRODUCT_DESCRIPTION", cfg.productDescription],
    ["SMOKE_VARIANT_SKU", cfg.variantSku],
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `seed_featured_artist requires env vars (or SMOKE_SEED_USERS_JSON values): ${missing.join(", ")}`
    );
  }

  return cfg;
};

const SEED_CONFIG = loadSeedConfig();
const SEED_SUPPLIER_SKU = "SMOKE-FEATURED-SUPPLIER-SKU-1";

const ensureUser = async (db, { id, email, role, password }) => {
  const passwordHash = await hashPassword(password);
  const existing = await db("users").where({ email }).first("id", "email", "role");

  if (existing) {
    const [updated] = await db("users")
      .where({ id: existing.id })
      .update({ role, password_hash: passwordHash })
      .returning(["id", "email", "role"]);
    return updated || existing;
  }

  const [created] = await db("users")
    .insert({
      id,
      email,
      role,
      password_hash: passwordHash,
      created_at: db.fn.now(),
    })
    .returning(["id", "email", "role"]);
  return created;
};

const ensureInventorySku = async (db) => {
  const hasSkuTable = await db.schema.hasTable("inventory_skus");
  if (!hasSkuTable) return null;

  const skuColumns = await db("inventory_skus").columnInfo();
  const hasSkuColumn = (name) => Object.prototype.hasOwnProperty.call(skuColumns, name);
  const selectColumns = ["id", "supplier_sku", "stock", "is_active"];
  if (hasSkuColumn("merch_type")) selectColumns.push("merch_type");
  if (hasSkuColumn("size")) selectColumns.push("size");
  if (hasSkuColumn("color")) selectColumns.push("color");

  const existing = await db("inventory_skus")
    .where({ supplier_sku: SEED_SUPPLIER_SKU })
    .first(...selectColumns);

  if (existing) {
    const patch = {
      is_active: true,
      stock: db.raw("GREATEST(stock, 20)"),
    };
    if (hasSkuColumn("merch_type")) patch.merch_type = "regular_tshirt";
    if (hasSkuColumn("quality_tier")) patch.quality_tier = "standard";
    if (hasSkuColumn("size")) patch.size = "M";
    if (hasSkuColumn("color")) patch.color = "Black";
    if (hasSkuColumn("updated_at")) patch.updated_at = db.fn.now();

    const [updated] = await db("inventory_skus")
      .where({ id: existing.id })
      .update(patch)
      .returning(selectColumns);
    return updated || existing;
  }

  const payload = {
    id: randomUUID(),
    supplier_sku: SEED_SUPPLIER_SKU,
    merch_type: "regular_tshirt",
    quality_tier: "standard",
    size: "M",
    color: "Black",
    stock: 20,
    is_active: true,
    created_at: db.fn.now(),
  };
  if (hasSkuColumn("updated_at")) payload.updated_at = db.fn.now();
  if (hasSkuColumn("metadata")) {
    payload.metadata = db.raw("?::jsonb", [JSON.stringify({ source: "seed_featured_artist" })]);
  }

  const [created] = await db("inventory_skus")
    .insert(payload)
    .returning(selectColumns);
  return created || payload;
};

async function runSeed(db) {
  const adminUser = await db("users").where({ email: SEED_CONFIG.adminEmail }).first("id");
  if (!adminUser?.id) {
    throw new Error(`Admin user ${SEED_CONFIG.adminEmail} is required for UI smoke seed`);
  }

  const artistUser = await ensureUser(db, {
    id: SEED_CONFIG.artistUserId,
    email: SEED_CONFIG.artistEmail,
    role: "artist",
    password: SEED_CONFIG.artistPassword,
  });

  const labelUser = await ensureUser(db, {
    id: SEED_CONFIG.labelUserId,
    email: SEED_CONFIG.labelEmail,
    role: "label",
    password: SEED_CONFIG.labelPassword,
  });

  let artist = await db("artists")
    .where({ handle: SEED_CONFIG.artistHandle })
    .first("id", "handle", "name", "is_featured");

  if (!artist) {
    const [createdArtist] = await db("artists")
      .insert({
        id: randomUUID(),
        handle: SEED_CONFIG.artistHandle,
        name: SEED_CONFIG.artistName,
        is_featured: true,
        created_at: db.fn.now(),
      })
      .returning(["id", "handle", "name", "is_featured"]);
    artist = createdArtist;
  } else if (!artist.is_featured) {
    const [updatedArtist] = await db("artists")
      .where({ id: artist.id })
      .update({ is_featured: true })
      .returning(["id", "handle", "name", "is_featured"]);
    artist = updatedArtist || artist;
  }

  let label = await db("labels").where({ handle: SEED_CONFIG.labelHandle }).first("id", "handle", "name");
  if (!label) {
    const [createdLabel] = await db("labels")
      .insert({
        id: randomUUID(),
        handle: SEED_CONFIG.labelHandle,
        name: SEED_CONFIG.labelName,
        created_at: db.fn.now(),
      })
      .returning(["id", "handle", "name"]);
    label = createdLabel;
  }

  await db("artist_user_map")
    .insert({
      id: randomUUID(),
      artist_id: artist.id,
      user_id: artistUser.id,
    })
    .onConflict(["artist_id", "user_id"])
    .ignore();

  await db("label_artist_map")
    .insert({
      id: randomUUID(),
      label_id: label.id,
      artist_id: artist.id,
    })
    .onConflict(["label_id", "artist_id"])
    .ignore();

  await db("label_users_map")
    .insert({
      user_id: labelUser.id,
      label_id: label.id,
      created_at: db.fn.now(),
    })
    .onConflict("user_id")
    .merge({ label_id: label.id });

  let product = await db("products")
    .where({ artist_id: artist.id, title: SEED_CONFIG.productTitle })
    .first("id", "artist_id", "title", "description", "is_active");

  if (!product) {
    const [createdProduct] = await db("products")
      .insert({
        id: randomUUID(),
        artist_id: artist.id,
        title: SEED_CONFIG.productTitle,
        description: SEED_CONFIG.productDescription,
        is_active: true,
        created_at: db.fn.now(),
      })
      .returning(["id", "artist_id", "title", "description", "is_active"]);
    product = createdProduct;
  } else {
    const [updatedProduct] = await db("products")
      .where({ id: product.id })
      .update({
        description: SEED_CONFIG.productDescription,
        is_active: true,
      })
      .returning(["id", "artist_id", "title", "description", "is_active"]);
    product = updatedProduct || product;
  }

  const variantColumns = await db("product_variants").columnInfo();
  const hasVariantColumn = (name) => Object.prototype.hasOwnProperty.call(variantColumns, name);
  const inventorySku = await ensureInventorySku(db);
  if (hasVariantColumn("inventory_sku_id") && !inventorySku?.id) {
    throw new Error("seed_featured_artist requires a valid inventory_sku_id mapping");
  }

  let variant = await db("product_variants")
    .where({ sku: SEED_CONFIG.variantSku })
    .first(
      "id",
      "product_id",
      "sku",
      "size",
      "color",
      "price_cents",
      "stock",
      ...(hasVariantColumn("inventory_sku_id") ? ["inventory_sku_id"] : [])
    );

  if (!variant) {
    const payload = {
      id: randomUUID(),
      product_id: product.id,
      sku: SEED_CONFIG.variantSku,
      size: "M",
      color: "Black",
      price_cents: 2999,
      stock: 20,
      created_at: db.fn.now(),
    };
    if (hasVariantColumn("inventory_sku_id")) payload.inventory_sku_id = inventorySku.id;
    if (hasVariantColumn("selling_price_cents")) payload.selling_price_cents = 2999;
    if (hasVariantColumn("is_listed")) payload.is_listed = true;
    if (hasVariantColumn("updated_at")) payload.updated_at = db.fn.now();

    const [createdVariant] = await db("product_variants")
      .insert(payload)
      .returning([
        "id",
        "product_id",
        "sku",
        "size",
        "color",
        "price_cents",
        "stock",
        ...(hasVariantColumn("inventory_sku_id") ? ["inventory_sku_id"] : []),
      ]);
    variant = createdVariant;
  } else {
    const patch = {
      product_id: product.id,
      size: "M",
      color: "Black",
      price_cents: 2999,
      stock: db.raw("GREATEST(stock, 20)"),
    };
    if (hasVariantColumn("inventory_sku_id")) patch.inventory_sku_id = inventorySku.id;
    if (hasVariantColumn("selling_price_cents")) patch.selling_price_cents = 2999;
    if (hasVariantColumn("is_listed")) patch.is_listed = true;
    if (hasVariantColumn("updated_at")) patch.updated_at = db.fn.now();

    const [updatedVariant] = await db("product_variants")
      .where({ id: variant.id })
      .update(patch)
      .returning([
        "id",
        "product_id",
        "sku",
        "size",
        "color",
        "price_cents",
        "stock",
        ...(hasVariantColumn("inventory_sku_id") ? ["inventory_sku_id"] : []),
      ]);
    variant = updatedVariant || variant;
  }

  return {
    createdByUserId: adminUser.id,
    artistUser,
    labelUser,
    artist,
    label,
    product,
    variant,
    drop: null,
  };
}

async function main() {
  const db = getDb();
  try {
    const result = await runSeed(db);
    console.log(
      "Seeded featured artist:",
      JSON.stringify(
        {
          artistUserEmail: result.artistUser.email,
          labelUserEmail: result.labelUser.email,
          artistHandle: result.artist.handle,
          labelHandle: result.label.handle,
          productId: result.product.id,
          sku: result.variant.sku,
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
