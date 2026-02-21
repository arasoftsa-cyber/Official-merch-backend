const { randomUUID } = require("crypto");
const { getDb } = require("../src/config/db");
const { hashPassword } = require("../src/utils/password");

const ADMIN_EMAIL = "admin@test.com";
const ARTIST_USER_ID = "00000000-0000-0000-0000-000000000003";
const LABEL_USER_ID = "00000000-0000-0000-0000-000000000004";
const ARTIST_EMAIL = "artist@test.com";
const LABEL_EMAIL = "label@test.com";
const ARTIST_HANDLE = "ui-smoke-featured-artist";
const ARTIST_NAME = "UI Smoke Featured Artist";
const LABEL_HANDLE = "ui-smoke-label";
const LABEL_NAME = "UI Smoke Label";
const PRODUCT_TITLE = "UI Smoke Featured Product";
const PRODUCT_DESCRIPTION = "Deterministic product for UI smoke flows";
const VARIANT_SKU = "UI-SMOKE-FEATURED-SKU-1";

const resolvePassword = (envName, fallback) => {
  const value = String(process.env[envName] || "").trim();
  return value || fallback;
};

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

async function runSeed(db) {
  const adminUser = await db("users").where({ email: ADMIN_EMAIL }).first("id");
  if (!adminUser?.id) {
    throw new Error("admin@test.com is required for UI smoke seed");
  }

  const artistUser = await ensureUser(db, {
    id: ARTIST_USER_ID,
    email: ARTIST_EMAIL,
    role: "artist",
    password: resolvePassword("ARTIST_PASSWORD", "artist123"),
  });

  const labelUser = await ensureUser(db, {
    id: LABEL_USER_ID,
    email: LABEL_EMAIL,
    role: "label",
    password: resolvePassword("LABEL_PASSWORD", "label123"),
  });

  let artist = await db("artists")
    .where({ handle: ARTIST_HANDLE })
    .first("id", "handle", "name", "is_featured");

  if (!artist) {
    const [createdArtist] = await db("artists")
      .insert({
        id: randomUUID(),
        handle: ARTIST_HANDLE,
        name: ARTIST_NAME,
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

  let label = await db("labels").where({ handle: LABEL_HANDLE }).first("id", "handle", "name");
  if (!label) {
    const [createdLabel] = await db("labels")
      .insert({
        id: randomUUID(),
        handle: LABEL_HANDLE,
        name: LABEL_NAME,
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
    .where({ artist_id: artist.id, title: PRODUCT_TITLE })
    .first("id", "artist_id", "title", "description", "is_active");

  if (!product) {
    const [createdProduct] = await db("products")
      .insert({
        id: randomUUID(),
        artist_id: artist.id,
        title: PRODUCT_TITLE,
        description: PRODUCT_DESCRIPTION,
        is_active: true,
        created_at: db.fn.now(),
      })
      .returning(["id", "artist_id", "title", "description", "is_active"]);
    product = createdProduct;
  } else {
    const [updatedProduct] = await db("products")
      .where({ id: product.id })
      .update({
        description: PRODUCT_DESCRIPTION,
        is_active: true,
      })
      .returning(["id", "artist_id", "title", "description", "is_active"]);
    product = updatedProduct || product;
  }

  let variant = await db("product_variants")
    .where({ sku: VARIANT_SKU })
    .first("id", "product_id", "sku", "size", "color", "price_cents", "stock");

  if (!variant) {
    const [createdVariant] = await db("product_variants")
      .insert({
        id: randomUUID(),
        product_id: product.id,
        sku: VARIANT_SKU,
        size: "M",
        color: "Black",
        price_cents: 2999,
        stock: 20,
        created_at: db.fn.now(),
      })
      .returning(["id", "product_id", "sku", "size", "color", "price_cents", "stock"]);
    variant = createdVariant;
  } else {
    const [updatedVariant] = await db("product_variants")
      .where({ id: variant.id })
      .update({
        product_id: product.id,
        size: "M",
        color: "Black",
        price_cents: 2999,
        stock: db.raw("GREATEST(stock, 20)"),
      })
      .returning(["id", "product_id", "sku", "size", "color", "price_cents", "stock"]);
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
