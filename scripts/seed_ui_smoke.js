require("dotenv").config();
const { randomUUID } = require("crypto");
const { getDb } = require("../src/config/db");
const { hashPassword } = require("../src/utils/password");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@test.com";
const BUYER_EMAIL = process.env.BUYER_EMAIL || "buyer@test.com";
const ARTIST_EMAIL = process.env.ARTIST_EMAIL || "artist@test.com";
const LABEL_EMAIL = process.env.LABEL_EMAIL || "label@test.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const BUYER_PASSWORD = process.env.BUYER_PASSWORD || "buyer123";
const ARTIST_PASSWORD = process.env.ARTIST_PASSWORD || "artist123";
const LABEL_PASSWORD = process.env.LABEL_PASSWORD || "label123";
const ARTIST_HANDLE = "seed-artist";
const LABEL_HANDLE = "test-label";
const PRODUCT_TITLE = "Seed Artist Tee";
const DROP_HANDLE = "seed-drop";
const VARIANT_SKU = "SEED-SKU-1";

const QUIZ_JSON = {
  version: 1,
  title: "Seed Drop Quiz",
  questions: [
    {
      id: "q1",
      type: "single_choice",
      prompt: "Which size do you prefer?",
      options: ["M", "L"],
      correct: "M",
      points: 10,
      required: true,
    },
  ],
};

const ensureUser = async (trx, { email, role, password, fallbackId }) => {
  const existing = await trx("users").where({ email }).first("id", "email", "role");
  const passwordHash = await hashPassword(password);

  if (existing) {
    const [updated] = await trx("users")
      .where({ id: existing.id })
      .update({ role, password_hash: passwordHash })
      .returning(["id", "email", "role"]);
    return updated || existing;
  }

  const [created] = await trx("users")
    .insert({
      id: fallbackId || randomUUID(),
      email,
      password_hash: passwordHash,
      role,
      created_at: trx.fn.now(),
    })
    .returning(["id", "email", "role"]);
  return created;
};

const ensureArtist = async (trx) => {
  const existing = await trx("artists")
    .where({ handle: ARTIST_HANDLE })
    .first("id", "handle", "name", "is_featured");

  if (existing) {
    const [updated] = await trx("artists")
      .where({ id: existing.id })
      .update({ name: "Seed Artist", is_featured: true })
      .returning(["id", "handle", "name", "is_featured"]);
    return updated || existing;
  }

  const [created] = await trx("artists")
    .insert({
      id: randomUUID(),
      handle: ARTIST_HANDLE,
      name: "Seed Artist",
      theme_json: {},
      is_featured: true,
      created_at: trx.fn.now(),
    })
    .returning(["id", "handle", "name", "is_featured"]);
  return created;
};

const ensureLabel = async (trx) => {
  const existing = await trx("labels")
    .where({ handle: LABEL_HANDLE })
    .first("id", "handle", "name");

  if (existing) {
    const [updated] = await trx("labels")
      .where({ id: existing.id })
      .update({ name: "Seed Label" })
      .returning(["id", "handle", "name"]);
    return updated || existing;
  }

  const [created] = await trx("labels")
    .insert({
      id: randomUUID(),
      handle: LABEL_HANDLE,
      name: "Seed Label",
      created_at: trx.fn.now(),
    })
    .returning(["id", "handle", "name"]);
  return created;
};

const ensureProduct = async (trx, artistId) => {
  const existing = await trx("products")
    .where({ artist_id: artistId, title: PRODUCT_TITLE })
    .first("id", "artist_id", "title", "is_active");

  if (existing) {
    const [updated] = await trx("products")
      .where({ id: existing.id })
      .update({
        artist_id: artistId,
        title: PRODUCT_TITLE,
        description: "Deterministic seeded product",
        is_active: true,
      })
      .returning(["id", "artist_id", "title", "is_active"]);
    return updated || existing;
  }

  const [created] = await trx("products")
    .insert({
      id: randomUUID(),
      artist_id: artistId,
      title: PRODUCT_TITLE,
      description: "Deterministic seeded product",
      is_active: true,
      created_at: trx.fn.now(),
    })
    .returning(["id", "artist_id", "title", "is_active"]);
  return created;
};

const ensureVariant = async (trx, productId) => {
  const existing = await trx("product_variants")
    .where({ sku: VARIANT_SKU })
    .first("id", "product_id", "sku", "price_cents", "stock");

  if (existing) {
    const [updated] = await trx("product_variants")
      .where({ id: existing.id })
      .update({
        product_id: productId,
        sku: VARIANT_SKU,
        size: "M",
        color: "Black",
        price_cents: 2999,
        stock: trx.raw("GREATEST(stock, 10)"),
      })
      .returning(["id", "product_id", "sku", "price_cents", "stock"]);
    return updated || existing;
  }

  const [created] = await trx("product_variants")
    .insert({
      id: randomUUID(),
      product_id: productId,
      sku: VARIANT_SKU,
      size: "M",
      color: "Black",
      price_cents: 2999,
      stock: 10,
      created_at: trx.fn.now(),
    })
    .returning(["id", "product_id", "sku", "price_cents", "stock"]);
  return created;
};

const ensureDrop = async (trx, { productId, artistId, adminUserId }) => {
  const hasFeaturedColumn = await trx.schema.hasColumn("drops", "is_featured");
  const existing = await trx("drops")
    .where({ handle: DROP_HANDLE })
    .first("id", "handle");

  const dropPayload = {
    title: "Seed Drop",
    description: "Deterministic published drop",
    status: "published",
    artist_id: artistId,
    label_id: null,
    quiz_json: QUIZ_JSON,
    updated_at: trx.fn.now(),
  };
  if (hasFeaturedColumn) {
    dropPayload.is_featured = true;
  }

  let drop = existing;
  if (!drop) {
    const [created] = await trx("drops")
      .insert({
        id: randomUUID(),
        handle: DROP_HANDLE,
        created_by_user_id: adminUserId,
        created_at: trx.fn.now(),
        ...dropPayload,
      })
      .returning(["id", "handle"]);
    drop = created;
  } else {
    const [updated] = await trx("drops")
      .where({ id: drop.id })
      .update(dropPayload)
      .returning(["id", "handle"]);
    drop = updated || drop;
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

  const [{ total = 0 } = {}] = await trx("drop_products")
    .where({ drop_id: drop.id })
    .countDistinct("product_id as total");
  if (Number(total) === 0) {
    const fallbackProduct = await trx("products")
      .where({ artist_id: artistId })
      .first("id");
    if (fallbackProduct?.id) {
      await trx("drop_products")
        .insert({
          drop_id: drop.id,
          product_id: fallbackProduct.id,
          sort_order: 0,
          created_at: trx.fn.now(),
        })
        .onConflict(["drop_id", "product_id"])
        .ignore();
    }
  }

  return drop;
};

const ensureOrder = async (trx, { buyerUserId, actorUserId, productId, variantId, priceCents }) => {
  let order = await trx("orders")
    .where({ buyer_user_id: buyerUserId, status: "placed" })
    .orderBy("created_at", "desc")
    .first("id", "buyer_user_id", "status", "total_cents");

  if (!order) {
    const [created] = await trx("orders")
      .insert({
        id: randomUUID(),
        buyer_user_id: buyerUserId,
        status: "placed",
        total_cents: priceCents,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning(["id", "buyer_user_id", "status", "total_cents"]);
    order = created;
  } else {
    const [updated] = await trx("orders")
      .where({ id: order.id })
      .update({
        status: "placed",
        total_cents: priceCents,
        updated_at: trx.fn.now(),
      })
      .returning(["id", "buyer_user_id", "status", "total_cents"]);
    order = updated || order;
  }

  const existingItem = await trx("order_items")
    .where({ order_id: order.id, product_variant_id: variantId })
    .first("id");
  if (existingItem) {
    await trx("order_items").where({ id: existingItem.id }).update({
      product_id: productId,
      quantity: 1,
      price_cents: priceCents,
    });
  } else {
    await trx("order_items").insert({
      id: randomUUID(),
      order_id: order.id,
      product_id: productId,
      product_variant_id: variantId,
      quantity: 1,
      price_cents: priceCents,
      created_at: trx.fn.now(),
    });
  }

  const hasOrderEvents = await trx.schema.hasTable("order_events");
  if (hasOrderEvents) {
    const existingEvent = await trx("order_events")
      .where({ order_id: order.id, type: "placed" })
      .first("id");
    if (!existingEvent) {
      await trx("order_events").insert({
        id: randomUUID(),
        order_id: order.id,
        type: "placed",
        actor_user_id: actorUserId,
        note: "Seeded order event",
        created_at: trx.fn.now(),
      });
    }
  }

  const hasPayments = await trx.schema.hasTable("payments");
  if (hasPayments) {
    await trx("payments")
      .insert({
        order_id: order.id,
        status: "paid",
        provider: "mock",
        amount_cents: priceCents,
        currency: "INR",
        provider_payment_id: `seed-payment-${order.id}`,
        paid_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .onConflict("order_id")
      .merge({
        status: "paid",
        provider: "mock",
        amount_cents: priceCents,
        currency: "INR",
        paid_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
  }

  return order;
};

const ensureArtistLinksForSmokeUsers = async (trx, artistId, primaryArtistUserId) => {
  const artistUsers = await trx("users")
    .select("id")
    .where({ role: "artist" });

  const ids = new Set(
    artistUsers
      .map((row) => row?.id)
      .filter((id) => typeof id === "string" && id.length > 0)
  );
  if (primaryArtistUserId) {
    ids.add(primaryArtistUserId);
  }

  for (const userId of ids) {
    await trx("artist_user_map")
      .insert({
        id: randomUUID(),
        artist_id: artistId,
        user_id: userId,
      })
      .onConflict(["artist_id", "user_id"])
      .ignore();
  }
};

async function seedUiSmoke({ env }) {
  const db = getDb();
  return db.transaction(async (trx) => {
    const adminUser = await ensureUser(trx, {
      email: ADMIN_EMAIL,
      role: "admin",
      password: ADMIN_PASSWORD,
      fallbackId: "00000000-0000-0000-0000-000000000001",
    });

    const buyerUser = await ensureUser(trx, {
      email: BUYER_EMAIL,
      role: "buyer",
      password: BUYER_PASSWORD,
      fallbackId: "00000000-0000-0000-0000-000000000002",
    });
    const artistUser = await ensureUser(trx, {
      email: ARTIST_EMAIL,
      role: "artist",
      password: ARTIST_PASSWORD,
      fallbackId: "00000000-0000-0000-0000-000000000003",
    });
    const labelUser = await ensureUser(trx, {
      email: LABEL_EMAIL,
      role: "label",
      password: LABEL_PASSWORD,
      fallbackId: "00000000-0000-0000-0000-000000000004",
    });

    const artist = await ensureArtist(trx);
    const label = await ensureLabel(trx);

    await ensureArtistLinksForSmokeUsers(trx, artist.id, artistUser.id);

    await trx("label_artist_map")
      .insert({
        id: randomUUID(),
        label_id: label.id,
        artist_id: artist.id,
      })
      .onConflict(["label_id", "artist_id"])
      .ignore();

    const hasLabelUsersMap = await trx.schema.hasTable("label_users_map");
    if (hasLabelUsersMap) {
      await trx("label_users_map")
        .insert({
          user_id: labelUser.id,
          label_id: label.id,
          created_at: trx.fn.now(),
        })
        .onConflict("user_id")
        .merge({ label_id: label.id });
    }

    const product = await ensureProduct(trx, artist.id);
    const variant = await ensureVariant(trx, product.id);
    const drop = await ensureDrop(trx, {
      productId: product.id,
      artistId: artist.id,
      adminUserId: adminUser.id,
    });
    const order = await ensureOrder(trx, {
      buyerUserId: buyerUser.id,
      actorUserId: adminUser.id,
      productId: product.id,
      variantId: variant.id,
      priceCents: Number(variant.price_cents || 2999),
    });

    return {
      buyerUser,
      artistUser,
      labelUser,
      artist,
      label,
      product,
      variant,
      drop,
      order,
    };
  });
}

module.exports = { seedUiSmoke };
