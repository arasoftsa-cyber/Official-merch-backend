const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../src/config/db");

const router = express.Router();

const isDevMode = process.env.NODE_ENV !== "production";

router.post("/dev/seed-artist-access-lead", async (req, res, next) => {
  if (!isDevMode) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  try {
    const db = getDb();
    const id = randomUUID();
    const answers = {
      pitch: "I build limited-edition merch.",
      socials: { instagram: "@nova" },
    };
    const [row] = await db("leads")
      .insert({
        id,
        source: "artist_access",
        name: "Nova Maker",
        artist_handle: "nova",
        email: "nova@example.com",
        phone: "+1-555-0100",
        answers_json: answers,
        created_at: db.fn.now(),
      })
      .returning(["id", "source", "name", "artist_handle", "email", "phone", "answers_json", "created_at"]);

    const inserted = Array.isArray(row) ? row[0] : row;
    return res.status(201).json({ ok: true, inserted });
  } catch (err) {
    next(err);
  }
});

router.post("/dev/seed-artist-access-request", async (req, res, next) => {
  if (!isDevMode) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const {
    artist_name,
    handle,
    contact_email,
    contact_phone,
    pitch,
    socials,
  } = req.body || {};

  const defaults = {
    artist_name: artist_name || "Test Artist",
    handle: handle || "test-artist",
    contact_email: contact_email || "test@example.com",
    contact_phone: contact_phone || "9999999999",
    pitch: pitch || "Test request",
    socials: socials || { instagram: "https://instagram.com/test" },
  };

  try {
    const db = getDb();
    const [row] = await db("artist_access_requests")
      .insert({
        id: randomUUID(),
        artist_name: defaults.artist_name,
        handle: defaults.handle,
        contact_email: defaults.contact_email,
        contact_phone: defaults.contact_phone,
        socials: defaults.socials,
        pitch: defaults.pitch,
        status: "pending",
        created_at: db.fn.now(),
      })
      .returning(["id", "artist_name", "handle", "contact_email", "contact_phone", "status"]);

    const inserted = Array.isArray(row) ? row[0] : row;
    return res.status(201).json({ ok: true, inserted });
  } catch (err) {
    next(err);
  }
});

router.post("/dev/link-label-user", async (req, res, next) => {
  if (!isDevMode) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const { userId, labelId } = req.body || {};
  if (!userId || !labelId) {
    return res.status(400).json({
      ok: false,
      error: "missing_parameters",
      message: "userId and labelId are required",
    });
  }

  try {
    const db = getDb();
    const rows = await db("label_users_map")
      .insert({
        user_id: userId,
        label_id: labelId,
        created_at: db.fn.now(),
      })
      .onConflict("user_id")
      .merge({ label_id: labelId })
      .returning(["id", "user_id", "label_id", "created_at"]);

    const mapping = Array.isArray(rows) ? rows[0] : rows;
    return res.json({ ok: true, mapping });
  } catch (err) {
    next(err);
  }
});

router.get("/dev/list-artist-access-leads", async (req, res, next) => {
  if (!isDevMode) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  try {
    const db = getDb();
    const rows = await db("leads")
      .where("source", "artist_access")
      .orderBy("created_at", "desc")
      .limit(20)
      .select(
        "id",
        "source",
        "name",
        "artist_handle",
        "email",
        "phone",
        "answers_json",
        "created_at"
      );

    return res.json({ ok: true, count: rows.length, items: rows });
  } catch (err) {
    next(err);
  }
});

router.post("/dev/seed-ui-smoke-product", async (req, res, next) => {
  if (!isDevMode) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const PRODUCT_TITLE = "UI Smoke Purchasable Product";
  const PRODUCT_DESCRIPTION = "Stable seeded product for UI smoke";
  const ARTIST_HANDLE = "ui-smoke-catalog-artist";
  const ARTIST_NAME = "UI Smoke Catalog Artist";
  const VARIANT_SKU = "UI-SMOKE-SKU-1";

  try {
    const db = getDb();
    const result = await db.transaction(async (trx) => {
      let artist = await trx("artists").where({ handle: ARTIST_HANDLE }).first("id", "handle", "name");
      if (!artist) {
        const [createdArtist] = await trx("artists")
          .insert({
            id: randomUUID(),
            handle: ARTIST_HANDLE,
            name: ARTIST_NAME,
            created_at: trx.fn.now(),
          })
          .returning(["id", "handle", "name"]);
        artist = createdArtist;
      }

      let product = await trx("products")
        .where({ title: PRODUCT_TITLE, artist_id: artist.id })
        .first("id", "artist_id", "title", "is_active");

      if (!product) {
        const [createdProduct] = await trx("products")
          .insert({
            id: randomUUID(),
            artist_id: artist.id,
            title: PRODUCT_TITLE,
            description: PRODUCT_DESCRIPTION,
            is_active: true,
            created_at: trx.fn.now(),
          })
          .returning(["id", "artist_id", "title", "is_active"]);
        product = createdProduct;
      } else {
        const [updatedProduct] = await trx("products")
          .where({ id: product.id })
          .update({
            is_active: true,
            description: PRODUCT_DESCRIPTION,
          })
          .returning(["id", "artist_id", "title", "is_active"]);
        product = updatedProduct || product;
      }

      let variant = await trx("product_variants")
        .where({ sku: VARIANT_SKU })
        .first("id", "product_id", "sku", "size", "color", "price_cents", "stock");

      if (!variant) {
        const [createdVariant] = await trx("product_variants")
          .insert({
            id: randomUUID(),
            product_id: product.id,
            sku: VARIANT_SKU,
            size: "M",
            color: "Black",
            price_cents: 1999,
            stock: 10,
            created_at: trx.fn.now(),
          })
          .returning(["id", "product_id", "sku", "size", "color", "price_cents", "stock"]);
        variant = createdVariant;
      } else {
        const [updatedVariant] = await trx("product_variants")
          .where({ id: variant.id })
          .update({
            product_id: product.id,
            size: "M",
            color: "Black",
            price_cents: 1999,
            stock: trx.raw("GREATEST(stock, 10)"),
          })
          .returning(["id", "product_id", "sku", "size", "color", "price_cents", "stock"]);
        variant = updatedVariant || variant;
      }

      return { artist, product, variant };
    });

    console.log(
      `[ui-smoke-seed] productId=${result.product.id} sku=${result.variant.sku}`
    );
    return res.json({
      ok: true,
      productId: result.product.id,
      sku: result.variant.sku,
      product: result.product,
      variant: result.variant,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
