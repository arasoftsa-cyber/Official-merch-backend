"use strict";

const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { requireAuth } = require("../core/http/auth.middleware");
const { ok, fail } = require("../core/http/errorResponse");
const { getSystemCurrency } = require("../config/currency");

const router = express.Router();

const FORBIDDEN = "forbidden";
const CART_ITEM_NOT_FOUND = "cart_item_not_found";
const PRODUCT_NOT_FOUND = "product_not_found";
const OUT_OF_STOCK = "out_of_stock";
const VALIDATION_ERROR = "validation_error";

const BUYER_ROLES = new Set(["buyer", "fan", "artist", "label", "admin"]);

const getRole = (user) =>
  user ? String(user.role || user.userRole || "").trim().toLowerCase() : "";

const isBuyer = (user) => BUYER_ROLES.has(getRole(user));

const rejectIfNotBuyer = (req, res) => {
  if (!isBuyer(req.user)) {
    fail(res, 403, FORBIDDEN, "Forbidden");
    return false;
  }
  return true;
};

const requireBuyer = (req, res, next) => {
  if (rejectIfNotBuyer(req, res)) next();
};

const parsePositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const resolveVariantPriceCents = (variant) => {
  const value =
    variant?.selling_price_cents == null ? variant?.price_cents : variant?.selling_price_cents;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const loadVariantSnapshot = async ({ db, productId, productVariantId }) => {
  const variant = await db("product_variants")
    .where({ id: productVariantId, product_id: productId })
    .first();
  if (!variant) return null;

  const [product, sku] = await Promise.all([
    db("products").where({ id: productId }).first(),
    variant.inventory_sku_id
      ? db("inventory_skus").where({ id: variant.inventory_sku_id }).first()
      : Promise.resolve(null),
  ]);

  return {
    variant,
    product,
    sku,
  };
};

const getVariantAvailability = (snapshot) => {
  if (!snapshot?.variant || !snapshot?.product) {
    return { available: false, reason: PRODUCT_NOT_FOUND, stock: 0, priceCents: null };
  }

  const priceCents = resolveVariantPriceCents(snapshot.variant);
  const stock = Number(snapshot?.sku?.stock ?? snapshot?.variant?.stock ?? 0);
  const productActive = Boolean(snapshot.product.is_active);
  const variantListed =
    snapshot.variant.is_listed === undefined ? true : Boolean(snapshot.variant.is_listed);
  const skuActive = snapshot.sku ? Boolean(snapshot.sku.is_active) : true;

  if (!productActive || !variantListed || !skuActive || priceCents === null || stock <= 0) {
    return {
      available: false,
      reason: OUT_OF_STOCK,
      stock: Number.isFinite(stock) ? stock : 0,
      priceCents,
    };
  }

  return {
    available: true,
    reason: null,
    stock,
    priceCents,
  };
};

const getOrCreateCart = async (db, buyerUserId) => {
  let cart = await db("carts").where({ buyer_user_id: buyerUserId }).first();
  if (cart) return cart;

  const now = db.fn.now();
  const [inserted] = await db("carts")
    .insert({
      id: randomUUID(),
      buyer_user_id: buyerUserId,
      created_at: now,
      updated_at: now,
    })
    .returning(["id", "buyer_user_id", "created_at", "updated_at"]);

  return inserted;
};

const serializeCartItem = ({ item, snapshot }) => {
  const availability = getVariantAvailability(snapshot);
  const quantity = Number(item.quantity || 0);
  const unitPriceCents = availability.priceCents;
  const lineTotalCents =
    Number.isInteger(unitPriceCents) && quantity > 0 ? unitPriceCents * quantity : null;

  return {
    id: item.id,
    productId: item.product_id,
    productVariantId: item.product_variant_id,
    quantity,
    available: availability.available,
    availabilityReason: availability.reason,
    availableStock: availability.stock,
    unitPriceCents,
    lineTotalCents,
    product: snapshot?.product
      ? {
          id: snapshot.product.id,
          title: snapshot.product.title || null,
          isActive: Boolean(snapshot.product.is_active),
        }
      : null,
    variant: snapshot?.variant
      ? {
          id: snapshot.variant.id,
          inventorySkuId: snapshot.variant.inventory_sku_id || null,
          isListed:
            snapshot.variant.is_listed === undefined ? true : Boolean(snapshot.variant.is_listed),
        }
      : null,
    inventory: snapshot?.sku
      ? {
          supplierSku: snapshot.sku.supplier_sku || null,
          merchType: snapshot.sku.merch_type || null,
          qualityTier: snapshot.sku.quality_tier || null,
          size: snapshot.sku.size || null,
          color: snapshot.sku.color || null,
        }
      : null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
};

const serializeCart = async ({ db, cart }) => {
  if (!cart) {
    return {
      id: null,
      currency: getSystemCurrency(),
      subtotalCents: 0,
      items: [],
      createdAt: null,
      updatedAt: null,
    };
  }

  const rows = await db("cart_items").where({ cart_id: cart.id }).orderBy("updated_at", "desc");
  const items = [];
  let subtotalCents = 0;

  for (const row of rows) {
    const snapshot = await loadVariantSnapshot({
      db,
      productId: row.product_id,
      productVariantId: row.product_variant_id,
    });
    const item = serializeCartItem({ item: row, snapshot });
    if (Number.isInteger(item.lineTotalCents)) {
      subtotalCents += item.lineTotalCents;
    }
    items.push(item);
  }

  return {
    id: cart.id,
    buyerUserId: cart.buyer_user_id,
    currency: getSystemCurrency(),
    subtotalCents,
    items,
    createdAt: cart.created_at,
    updatedAt: cart.updated_at,
  };
};

const touchCart = async (db, cartId) => {
  await db("carts").where({ id: cartId }).update({ updated_at: db.fn.now() });
};

router.get("/", requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const db = getDb();
    const cart = await db("carts").where({ buyer_user_id: req.user.id }).first();
    ok(res, { cart: await serializeCart({ db, cart }) });
  } catch (err) {
    next(err);
  }
});

router.post("/items", requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const productId = String(req.body?.productId || "").trim();
    const productVariantId = String(req.body?.productVariantId || "").trim();
    const quantity = parsePositiveInteger(req.body?.quantity ?? 1);

    if (!productId || !productVariantId || quantity === null) {
      return fail(res, 400, VALIDATION_ERROR, "productId, productVariantId and quantity are required");
    }

    const db = getDb();
    const snapshot = await loadVariantSnapshot({ db, productId, productVariantId });
    if (!snapshot?.variant || !snapshot?.product) {
      return fail(res, 404, PRODUCT_NOT_FOUND, "Product variant not found");
    }

    const availability = getVariantAvailability(snapshot);
    if (!availability.available || quantity > availability.stock) {
      return fail(res, 409, OUT_OF_STOCK, "Requested quantity is not available");
    }

    const cart = await getOrCreateCart(db, req.user.id);
    const existing = await db("cart_items")
      .where({
        cart_id: cart.id,
        product_id: productId,
        product_variant_id: productVariantId,
      })
      .first();

    const nextQuantity = quantity + Number(existing?.quantity || 0);
    if (nextQuantity > availability.stock) {
      return fail(res, 409, OUT_OF_STOCK, "Requested quantity is not available");
    }

    const now = db.fn.now();
    if (existing) {
      await db("cart_items").where({ id: existing.id }).update({
        quantity: nextQuantity,
        updated_at: now,
      });
    } else {
      await db("cart_items").insert({
        id: randomUUID(),
        cart_id: cart.id,
        product_id: productId,
        product_variant_id: productVariantId,
        quantity,
        created_at: now,
        updated_at: now,
      });
    }

    await touchCart(db, cart.id);
    const refreshedCart = await db("carts").where({ id: cart.id }).first();
    ok(res, { cart: await serializeCart({ db, cart: refreshedCart }) });
  } catch (err) {
    next(err);
  }
});

router.patch("/items/:itemId", requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const quantity = parsePositiveInteger(req.body?.quantity);
    if (quantity === null) {
      return fail(res, 400, VALIDATION_ERROR, "quantity must be a positive integer");
    }

    const db = getDb();
    const cart = await db("carts").where({ buyer_user_id: req.user.id }).first();
    if (!cart) {
      return fail(res, 404, CART_ITEM_NOT_FOUND, "Cart item not found");
    }

    const item = await db("cart_items")
      .where({ id: req.params.itemId, cart_id: cart.id })
      .first();
    if (!item) {
      return fail(res, 404, CART_ITEM_NOT_FOUND, "Cart item not found");
    }

    const snapshot = await loadVariantSnapshot({
      db,
      productId: item.product_id,
      productVariantId: item.product_variant_id,
    });
    const availability = getVariantAvailability(snapshot);
    if (!availability.available || quantity > availability.stock) {
      return fail(res, 409, OUT_OF_STOCK, "Requested quantity is not available");
    }

    await db("cart_items").where({ id: item.id }).update({
      quantity,
      updated_at: db.fn.now(),
    });
    await touchCart(db, cart.id);

    const refreshedCart = await db("carts").where({ id: cart.id }).first();
    ok(res, { cart: await serializeCart({ db, cart: refreshedCart }) });
  } catch (err) {
    next(err);
  }
});

router.delete("/items/:itemId", requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const db = getDb();
    const cart = await db("carts").where({ buyer_user_id: req.user.id }).first();
    if (!cart) {
      return fail(res, 404, CART_ITEM_NOT_FOUND, "Cart item not found");
    }

    const deleted = await db("cart_items")
      .where({ id: req.params.itemId, cart_id: cart.id })
      .del();
    if (!deleted) {
      return fail(res, 404, CART_ITEM_NOT_FOUND, "Cart item not found");
    }

    await touchCart(db, cart.id);
    const refreshedCart = await db("carts").where({ id: cart.id }).first();
    ok(res, { cart: await serializeCart({ db, cart: refreshedCart }) });
  } catch (err) {
    next(err);
  }
});

router.delete("/", requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const db = getDb();
    const cart = await db("carts").where({ buyer_user_id: req.user.id }).first();
    if (!cart) {
      return ok(res, {
        cart: {
          id: null,
          currency: getSystemCurrency(),
          subtotalCents: 0,
          items: [],
          createdAt: null,
          updatedAt: null,
        },
      });
    }

    await db("cart_items").where({ cart_id: cart.id }).del();
    await touchCart(db, cart.id);
    const refreshedCart = await db("carts").where({ id: cart.id }).first();
    ok(res, { cart: await serializeCart({ db, cart: refreshedCart }) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.__test = {
  isBuyer,
  parsePositiveInteger,
  resolveVariantPriceCents,
  getVariantAvailability,
  serializeCartItem,
};
