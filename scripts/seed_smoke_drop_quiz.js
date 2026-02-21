const { randomUUID } = require("crypto");
const { getDb } = require("../src/config/db");

const ADMIN_EMAIL = "admin@test.com";
const DEFAULT_DROP_HANDLE = "ui-smoke-featured-drop";
const DROP_TITLE = "UI Smoke Featured Drop";
const DROP_DESCRIPTION = "Deterministic published drop for UI smoke flows";
const FALLBACK_VARIANT_SKU = "UI-SMOKE-FEATURED-SKU-1";

const QUIZ_JSON = {
  version: 1,
  title: "Smoke Drop Quiz",
  questions: [
    {
      id: "q1",
      type: "single_choice",
      prompt: "Which shirt color do you want?",
      options: ["Black", "White"],
      correct: "Black",
      points: 10,
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

async function resolveProduct(db, options = {}) {
  const explicitProductId = String(options.productId || "").trim();
  if (explicitProductId) {
    const row = await db("products")
      .where({ id: explicitProductId })
      .first("id", "artist_id");
    if (row) return row;
  }

  const bySku = await db("product_variants as pv")
    .join("products as p", "p.id", "pv.product_id")
    .where("pv.sku", FALLBACK_VARIANT_SKU)
    .first("p.id", "p.artist_id");
  return bySku || null;
}

async function runSeed(db, options = {}) {
  const product = await resolveProduct(db, options);
  if (!product?.id || !product?.artist_id) {
    throw new Error("seed_smoke_drop_quiz requires a valid artist-linked product");
  }

  const createdByUserId = String(options.createdByUserId || "").trim();
  let ownerUserId = createdByUserId;
  if (!ownerUserId) {
    const adminUser = await db("users").where({ email: ADMIN_EMAIL }).first("id");
    ownerUserId = adminUser?.id || "";
  }
  if (!ownerUserId) {
    throw new Error("admin@test.com is required for smoke drop seed");
  }

  const dropHandle = String(options.dropHandle || DEFAULT_DROP_HANDLE).trim() || DEFAULT_DROP_HANDLE;
  let drop = await db("drops")
    .where({ handle: dropHandle })
    .first("id", "handle", "artist_id", "status");

  if (!drop) {
    const [createdDrop] = await db("drops")
      .insert({
        id: randomUUID(),
        handle: dropHandle,
        title: DROP_TITLE,
        description: DROP_DESCRIPTION,
        status: "published",
        artist_id: product.artist_id,
        label_id: null,
        created_by_user_id: ownerUserId,
        quiz_json: QUIZ_JSON,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning(["id", "handle", "artist_id", "status"]);
    drop = createdDrop;
  } else {
    const [updatedDrop] = await db("drops")
      .where({ id: drop.id })
      .update({
        title: DROP_TITLE,
        description: DROP_DESCRIPTION,
        status: "published",
        artist_id: product.artist_id,
        label_id: null,
        quiz_json: QUIZ_JSON,
        updated_at: db.fn.now(),
      })
      .returning(["id", "handle", "artist_id", "status"]);
    drop = updatedDrop || drop;
  }

  await db("drop_products")
    .insert({
      drop_id: drop.id,
      product_id: product.id,
      sort_order: 0,
      created_at: db.fn.now(),
    })
    .onConflict(["drop_id", "product_id"])
    .merge({ sort_order: 0 });

  return db("drops")
    .select("id", "handle", "status", "quiz_json")
    .where({ id: drop.id })
    .first();
}

async function main() {
  const db = getDb();
  try {
    const updated = await runSeed(db);
    console.log(
      JSON.stringify(
        {
          updatedHandle: updated.handle,
          status: updated.status,
          hasQuiz: Boolean(updated.quiz_json),
          row: updated,
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
  main().catch(async (err) => {
    console.error(err);
    process.exit(1);
  });
}
