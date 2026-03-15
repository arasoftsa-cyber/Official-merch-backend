"use strict";

const { z } = require("zod");
const { createContractError, resolveAliasedField } = require("./shared");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const orderLineSchema = z.object({
  productId: z.string().trim().regex(UUID_RE, "productId must be a valid UUID"),
  productVariantId: z.string().trim().regex(UUID_RE, "productVariantId must be a valid UUID"),
  quantity: z.coerce
    .number()
    .int("quantity must be an integer")
    .min(1, "quantity must be at least 1")
    .max(10, "quantity must be at most 10"),
});

const createOrderSchema = z.object({
  items: z
    .array(orderLineSchema)
    .min(1, "items must contain at least one item")
    .max(50, "items cannot exceed 50 items"),
  currency: z.string().trim().min(1, "currency is required").optional(),
});

const normalizeLine = (input = {}) => {
  const productIdField = resolveAliasedField({
    input,
    canonicalKey: "productId",
    normalize: (value) => String(value || "").trim(),
  });
  const productVariantIdField = resolveAliasedField({
    input,
    canonicalKey: "productVariantId",
    normalize: (value) => String(value || "").trim(),
  });
  const quantityField = resolveAliasedField({
    input,
    canonicalKey: "quantity",
    normalize: (value) => value,
  });

  return {
    dto: {
      productId: productIdField.value,
      productVariantId: productVariantIdField.value,
      quantity: quantityField.value,
    },
    legacyKeys: [
      ...productIdField.legacyKeys,
      ...productVariantIdField.legacyKeys,
      ...quantityField.legacyKeys,
    ],
  };
};

const normalizeCreateOrderPayload = (input = {}) => {
  const body = input && typeof input === "object" ? input : {};
  const currencyField = resolveAliasedField({
    input: body,
    canonicalKey: "currency",
    normalize: (value) => String(value || "").trim().toUpperCase(),
  });

  let items = [];
  const legacyKeys = [...currencyField.legacyKeys];
  const hasItemsArray = Array.isArray(body.items);
  const hasLegacySingleShape =
    Object.prototype.hasOwnProperty.call(body, "productId") ||
    Object.prototype.hasOwnProperty.call(body, "productVariantId") ||
    Object.prototype.hasOwnProperty.call(body, "quantity");

  if (hasItemsArray) {
    const normalizedItems = body.items.map((entry) => normalizeLine(entry));
    items = normalizedItems.map((entry) => entry.dto);
    normalizedItems.forEach((entry) => legacyKeys.push(...entry.legacyKeys));
  }

  if (hasLegacySingleShape) {
    const singleItem = normalizeLine(body);
    if (hasItemsArray) {
      if (items.length !== 1) {
        throw createContractError({
          message: "Conflicting payload fields: 'items' and legacy single-item order fields both provided with different values.",
          details: [{ field: "items", message: "conflicts with legacy single-item payload fields" }],
        });
      }
      const canonical = items[0];
      if (
        canonical.productId !== singleItem.dto.productId ||
        canonical.productVariantId !== singleItem.dto.productVariantId ||
        Number(canonical.quantity) !== Number(singleItem.dto.quantity)
      ) {
        throw createContractError({
          message: "Conflicting payload fields: 'items' and legacy single-item order fields both provided with different values.",
          details: [{ field: "items", message: "conflicts with legacy single-item payload fields" }],
        });
      }
    } else {
      items = [singleItem.dto];
    }
  }

  return {
    dto: {
      items,
      currency: currencyField.value,
    },
    meta: {
      legacyKeys: hasLegacySingleShape
        ? ["productId", "productVariantId", "quantity", ...legacyKeys]
        : legacyKeys,
    },
  };
};

const validateCreateOrderPayload = (payload) => createOrderSchema.parse(payload);

const normalizeOrderPaymentPayload = (input = {}) => ({
  dto: {
    currency:
      typeof input?.currency === "undefined"
        ? undefined
        : String(input.currency || "").trim().toUpperCase(),
  },
  meta: {
    legacyKeys: [],
  },
});

module.exports = {
  normalizeCreateOrderPayload,
  validateCreateOrderPayload,
  normalizeOrderPaymentPayload,
};
