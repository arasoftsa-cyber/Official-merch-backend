const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");

const getActiveProducts = async () => {
  const db = getDb();
  return db("products")
    .select(
      "id",
      "title",
      "description",
      "created_at",
      "artist_id as artistId",
      "is_active",
      "is_active as isActive",
      db.raw(
        "(select min(price_cents) from product_variants v where v.product_id = products.id) as minVariantPriceCents"
      )
    )
    .where({ is_active: true });
};

const getProductsByArtistId = async (artistId) => {
  const db = getDb();
  return db("products")
    .select(
      "id",
      "title",
      "description",
      "created_at",
      "updated_at",
      "artist_id as artistId",
      "is_active",
      "is_active as isActive",
      db.raw(
        "(select min(price_cents) from product_variants v where v.product_id = products.id) as minVariantPriceCents"
      )
    )
    .where({ artist_id: artistId })
    .orderBy("created_at", "desc");
};

const getProductById = async (id) => {
  const db = getDb();
  const product = await db("products").where({ id }).first();
  if (!product) {
    return null;
  }
  const variants = await db("product_variants")
    .select("id", "sku", "size", "color", "price_cents as priceCents", "stock")
    .where({ product_id: id });
  return {
    product,
    variants,
  };
};

const createProductWithVariants = async (input) => {
  const db = getDb();
  return db.transaction(async (trx) => {
    const productId = randomUUID();
    await trx("products").insert({
      id: productId,
      artist_id: input.artistId,
      title: input.title,
      description: input.description || null,
      is_active: input.isActive === undefined ? true : input.isActive,
    });

    const variantRows = input.variants.map((variant) => ({
      id: randomUUID(),
      product_id: productId,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      price_cents: variant.priceCents,
      stock: variant.stock,
    }));

    await trx("product_variants").insert(variantRows);

    return productId;
  });
};

module.exports = {
  getActiveProducts,
  getProductsByArtistId,
  getProductById,
  createProductWithVariants,
};
