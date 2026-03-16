const { randomUUID } = require("crypto");
const {
  toInventorySkuPayload,
  listVariantsForProduct,
  orderVariantsByTouchedIds,
  findProductById,
  findVariantById,
  deleteVariantById,
} = require("./productVariants.repository");
const {
  PRODUCT_STATUS_ACTIVE,
  parseNonNegativeInt,
  parseInteger,
  parseBooleanMaybe,
  parseNullableText,
  throwWithCode,
  normalizeProductStatusValue,
  validateListedVariantPrice,
  normalizeVariant,
  validateUniqueInventorySkuMappings,
} = require("./productVariants.validators");
const { assertCatalogProductMutationSchema } = require("../core/db/schemaContract");

const putProductVariantsWorkflow = async ({ db, productId, variantsPayload = [] }) => {
  const normalized = [];
  for (const variant of variantsPayload) {
    const normalizedRow = normalizeVariant(variant);
    if (normalizedRow.error) {
      return { error: normalizedRow.error, statusCode: 400 };
    }
    normalized.push(normalizedRow.value);
  }

  if (!validateUniqueInventorySkuMappings(normalized)) {
    return { error: "duplicate_inventory_sku_mapping", statusCode: 409 };
  }

  const created = await db.transaction(async (trx) => {
    const touchedVariantIds = [];
    const {
      productColumns,
      variantColumns,
      inventorySkuColumns: skuColumns,
    } = await assertCatalogProductMutationSchema(trx);
    const hasProductColumn = (name) => Object.prototype.hasOwnProperty.call(productColumns, name);
    const hasVariantColumn = (name) => Object.prototype.hasOwnProperty.call(variantColumns, name);
    const hasSkuColumn = (name) => Object.prototype.hasOwnProperty.call(skuColumns, name);
    if (!hasVariantColumn("inventory_sku_id")) {
      throwWithCode("INVENTORY_SKU_NOT_CONFIGURED");
    }

    const existingSelection = ["id", "sku", "inventory_sku_id", "price_cents"];
    if (hasVariantColumn("is_listed")) existingSelection.push("is_listed");
    if (hasVariantColumn("selling_price_cents")) existingSelection.push("selling_price_cents");

    const existing = await trx("product_variants")
      .select(existingSelection)
      .where({ product_id: productId });
    const byId = new Map(existing.map((row) => [row.id, row]));
    const bySku = new Map(existing.map((row) => [row.sku, row]));
    const mappedSkuByVariantId = new Map(existing.map((row) => [row.id, row.inventory_sku_id || null]));

    const inventorySkuIds = Array.from(new Set(normalized.map((row) => row.inventory_sku_id).filter(Boolean)));
    const skuRows = inventorySkuIds.length
      ? await trx("inventory_skus").select("id", "stock").whereIn("id", inventorySkuIds)
      : [];
    if (inventorySkuIds.length > 0 && skuRows.length !== inventorySkuIds.length) {
      throwWithCode("INVENTORY_SKU_NOT_FOUND");
    }
    const knownInventorySkus = new Map(skuRows.map((row) => [row.id, { id: row.id, stock: row.stock }]));

    const ensureInventorySkuExists = async (inventorySkuId) => {
      if (!inventorySkuId) throwWithCode("INVENTORY_SKU_NOT_FOUND");
      if (knownInventorySkus.has(inventorySkuId)) return knownInventorySkus.get(inventorySkuId);
      const row = await trx("inventory_skus").select("id", "stock").where({ id: inventorySkuId }).first();
      if (!row?.id) throwWithCode("INVENTORY_SKU_NOT_FOUND");
      const normalizedSku = { id: row.id, stock: row.stock };
      knownInventorySkus.set(inventorySkuId, normalizedSku);
      return normalizedSku;
    };

    const createTransitionalInventorySku = async ({ variant, index }) => {
      const compact = (value, fallback) =>
        String(value || fallback).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12) || fallback;
      const colorSegment = compact(variant.color, "DEFAULT");
      const sizeSegment = compact(variant.size, "DEFAULT");
      const base = `LEGACY-${String(productId).slice(0, 8)}-${colorSegment}-${sizeSegment}`;
      const stockValue = typeof variant.stock === "number" ? variant.stock : 0;

      let attempt = 0;
      while (attempt < 4) {
        const supplierSku =
          attempt === 0 ? base : `${base}-${String(randomUUID()).slice(0, 6).toUpperCase()}`;
        try {
          const skuPayload = {
            id: randomUUID(),
            supplier_sku: supplierSku,
            merch_type: "default",
            quality_tier: null,
            size: variant.size,
            color: variant.color,
            stock: stockValue,
            is_active: true,
            metadata: trx.raw(
              "?::jsonb",
              [JSON.stringify({ source: "productVariants.routes.put.legacy", index })]
            ),
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          };
          if (hasSkuColumn("mrp_cents") && typeof variant.selling_price_cents === "number") {
            skuPayload.mrp_cents = variant.selling_price_cents;
          }
          const [inserted] = await trx("inventory_skus").insert(skuPayload).returning(["id"]);
          const createdId = inserted?.id || skuPayload.id;
          knownInventorySkus.set(createdId, { id: createdId, stock: stockValue });
          return createdId;
        } catch (err) {
          if (err?.code === "23505" || err?.message?.includes("duplicate key")) {
            attempt += 1;
            continue;
          }
          throw err;
        }
      }
      throwWithCode("INVENTORY_SKU_CONFLICT");
    };

    for (let idx = 0; idx < normalized.length; idx += 1) {
      const variant = normalized[idx];
      const existingVariant = (variant.id ? byId.get(variant.id) : null) || (variant.sku ? bySku.get(variant.sku) : null) || null;
      let resolvedInventorySkuId = variant.inventory_sku_id || existingVariant?.inventory_sku_id || null;
      if (!resolvedInventorySkuId) {
        resolvedInventorySkuId = await createTransitionalInventorySku({ variant, index: idx });
      }
      const resolvedInventorySku = await ensureInventorySkuExists(resolvedInventorySkuId);
      const resolvedInventorySkuStock = parseNonNegativeInt(resolvedInventorySku?.stock) ?? 0;

      const existingListed =
        !existingVariant || existingVariant.is_listed === null || typeof existingVariant.is_listed === "undefined"
          ? true
          : Boolean(existingVariant.is_listed);
      const nextIsListed = typeof variant.is_listed === "boolean" ? variant.is_listed : existingListed;
      const existingSellingPrice = parseNonNegativeInt(existingVariant?.selling_price_cents ?? existingVariant?.price_cents);
      const nextSellingPrice =
        typeof variant.selling_price_cents === "number" ? variant.selling_price_cents : existingSellingPrice;
      if (!validateListedVariantPrice({ isListed: nextIsListed, sellingPriceCents: nextSellingPrice })) {
        throwWithCode("INVALID_PRICE");
      }

      if (existingVariant) {
        for (const [otherVariantId, mappedSkuId] of mappedSkuByVariantId.entries()) {
          if (otherVariantId !== existingVariant.id && mappedSkuId && mappedSkuId === resolvedInventorySkuId) {
            throwWithCode("DUPLICATE_INVENTORY_SKU_MAPPING");
          }
        }

        const patch = { inventory_sku_id: resolvedInventorySkuId, size: variant.size, color: variant.color };
        if (variant.sku) patch.sku = variant.sku;
        if (typeof variant.selling_price_cents === "number") {
          patch.price_cents = variant.selling_price_cents;
          if (hasVariantColumn("selling_price_cents")) patch.selling_price_cents = variant.selling_price_cents;
        }
        if (typeof variant.is_listed === "boolean" && hasVariantColumn("is_listed")) patch.is_listed = variant.is_listed;
        if (typeof variant.stock === "number" && hasVariantColumn("stock")) patch.stock = variant.stock;
        else if (hasVariantColumn("stock") && existingVariant?.inventory_sku_id !== resolvedInventorySkuId) patch.stock = resolvedInventorySkuStock;
        if (typeof variant.vendor_payout_cents === "number" && hasVariantColumn("vendor_payout_cents")) patch.vendor_payout_cents = variant.vendor_payout_cents;
        if (typeof variant.royalty_cents === "number" && hasVariantColumn("royalty_cents")) patch.royalty_cents = variant.royalty_cents;
        if (typeof variant.our_share_cents === "number" && hasVariantColumn("our_share_cents")) patch.our_share_cents = variant.our_share_cents;
        if (hasVariantColumn("updated_at")) patch.updated_at = trx.fn.now();

        await trx("product_variants").where({ id: existingVariant.id, product_id: productId }).update(patch);
        if (typeof variant.stock === "number") {
          const stockUpdated = await trx("inventory_skus").where({ id: resolvedInventorySkuId }).update({ stock: variant.stock, updated_at: trx.fn.now() });
          if (!stockUpdated) throwWithCode("INVENTORY_SKU_NOT_FOUND");
        }
        mappedSkuByVariantId.set(existingVariant.id, resolvedInventorySkuId);
        touchedVariantIds.push(existingVariant.id);
        continue;
      }

      for (const mappedSkuId of mappedSkuByVariantId.values()) {
        if (mappedSkuId && mappedSkuId === resolvedInventorySkuId) throwWithCode("DUPLICATE_INVENTORY_SKU_MAPPING");
      }

      const baseSku = variant.sku || `SKU-${String(productId).slice(0, 8)}-${idx + 1}`;
      let insertedId = null;
      let attempt = 0;
      while (attempt < 4 && !insertedId) {
        const skuCandidate =
          attempt === 0 ? baseSku : `${baseSku}-${String(randomUUID()).slice(0, 6).toUpperCase()}`;
        try {
          const insertPayload = {
            id: randomUUID(),
            product_id: productId,
            inventory_sku_id: resolvedInventorySkuId,
            sku: skuCandidate,
            size: variant.size,
            color: variant.color,
            created_at: trx.fn.now(),
            price_cents: typeof variant.selling_price_cents === "number" ? variant.selling_price_cents : 0,
          };
          if (hasVariantColumn("selling_price_cents")) insertPayload.selling_price_cents = insertPayload.price_cents;
          if (hasVariantColumn("is_listed")) insertPayload.is_listed = typeof variant.is_listed === "boolean" ? variant.is_listed : true;
          if (typeof variant.vendor_payout_cents === "number" && hasVariantColumn("vendor_payout_cents")) insertPayload.vendor_payout_cents = variant.vendor_payout_cents;
          if (typeof variant.royalty_cents === "number" && hasVariantColumn("royalty_cents")) insertPayload.royalty_cents = variant.royalty_cents;
          if (typeof variant.our_share_cents === "number" && hasVariantColumn("our_share_cents")) insertPayload.our_share_cents = variant.our_share_cents;
          if (hasVariantColumn("updated_at")) insertPayload.updated_at = trx.fn.now();
          if (hasVariantColumn("stock")) insertPayload.stock = typeof variant.stock === "number" ? variant.stock : resolvedInventorySkuStock;

          const [inserted] = await trx("product_variants").insert(insertPayload).returning(["id"]);
          insertedId = inserted?.id || null;
          if (insertedId) {
            mappedSkuByVariantId.set(insertedId, resolvedInventorySkuId);
            touchedVariantIds.push(insertedId);
          }
        } catch (err) {
          if (err?.code === "23505" || err?.message?.includes("duplicate key")) {
            attempt += 1;
            continue;
          }
          throw err;
        }
      }
      if (!insertedId) throwWithCode("VARIANT_SKU_CONFLICT");

      if (typeof variant.stock === "number") {
        const stockUpdated = await trx("inventory_skus").where({ id: resolvedInventorySkuId }).update({ stock: variant.stock, updated_at: trx.fn.now() });
        if (!stockUpdated) throwWithCode("INVENTORY_SKU_NOT_FOUND");
      }
    }

    if (hasProductColumn("status") && hasProductColumn("is_active")) {
      const productSnapshot = await trx("products").select("id", "status", "is_active").where({ id: productId }).first();
      const normalizedStatus = normalizeProductStatusValue(productSnapshot?.status);
      if (normalizedStatus) {
        const expectedIsActive = normalizedStatus === PRODUCT_STATUS_ACTIVE;
        const currentIsActive =
          productSnapshot?.is_active === true ||
          productSnapshot?.is_active === "true" ||
          productSnapshot?.is_active === 1 ||
          productSnapshot?.is_active === "1";
        if (currentIsActive !== expectedIsActive) {
          const productPatch = { is_active: expectedIsActive };
          if (hasProductColumn("updated_at")) productPatch.updated_at = trx.fn.now();
          await trx("products").where({ id: productId }).update(productPatch);
        }
      }
    }

    return { touchedVariantIds };
  });

  const variants = await listVariantsForProduct(db, productId);
  const orderedVariants = orderVariantsByTouchedIds(variants, created?.touchedVariantIds || []);
  return { statusCode: 200, body: { productId, variants: orderedVariants, items: orderedVariants } };
};

const putVariantErrorResponse = (err) => {
  if (err?.code === "INVENTORY_SKU_NOT_FOUND") return { statusCode: 400, body: { error: "inventory_sku_not_found" } };
  if (err?.code === "INVENTORY_SKU_NOT_CONFIGURED") return { statusCode: 500, body: { error: "inventory_sku_not_configured" } };
  if (err?.code === "INVALID_PRICE") return { statusCode: 400, body: { error: "invalid_price" } };
  if (err?.code === "DUPLICATE_INVENTORY_SKU_MAPPING" || err?.code === "23505") {
    return { statusCode: 409, body: { error: "duplicate_inventory_sku_mapping" } };
  }
  if (err?.code === "VARIANT_SKU_CONFLICT") return { statusCode: 500, body: { error: "variant_sku_conflict" } };
  if (err?.code === "INVENTORY_SKU_CONFLICT") return { statusCode: 500, body: { error: "inventory_sku_conflict" } };
  return null;
};

const getProductVariantsResponse = async ({ db, productId }) => {
  const product = await findProductById(db, productId);
  if (!product) return { statusCode: 404, body: { error: "product_not_found" } };
  const variants = await listVariantsForProduct(db, productId);
  return { statusCode: 200, body: { productId: product.id, variants, items: variants } };
};

const deleteVariantResponse = async ({ db, variantId }) => {
  const variant = await findVariantById(db, variantId);
  if (!variant) return { statusCode: 404, body: { error: "variant_not_found" } };
  await deleteVariantById(db, variantId);
  return { statusCode: 200, body: { ok: true } };
};

const listInventorySkusResponse = async ({ db, query }) => {
  const requestQuery = query || {};
  const dbQuery = db("inventory_skus")
    .select(
      "id",
      "supplier_sku",
      "merch_type",
      "quality_tier",
      "size",
      "color",
      "stock",
      "is_active",
      "supplier_cost_cents",
      "mrp_cents",
      "metadata",
      "created_at",
      "updated_at"
    )
    .orderBy("updated_at", "desc");

  if (typeof requestQuery.merch_type === "string" && requestQuery.merch_type.trim()) {
    dbQuery.where("merch_type", requestQuery.merch_type.trim());
  }
  if (typeof requestQuery.color === "string" && requestQuery.color.trim()) {
    dbQuery.where("color", requestQuery.color.trim());
  }
  if (typeof requestQuery.size === "string" && requestQuery.size.trim()) {
    dbQuery.where("size", requestQuery.size.trim());
  }
  if (typeof requestQuery.q === "string" && requestQuery.q.trim()) {
    const q = requestQuery.q.trim();
    dbQuery.andWhere((builder) => {
      builder
        .whereRaw("supplier_sku ilike ?", [`%${q}%`])
        .orWhereRaw("merch_type ilike ?", [`%${q}%`])
        .orWhereRaw("color ilike ?", [`%${q}%`])
        .orWhereRaw("size ilike ?", [`%${q}%`]);
    });
  }

  const isActiveFilter = parseBooleanMaybe(requestQuery.is_active ?? requestQuery.isActive);
  if (isActiveFilter !== null && typeof isActiveFilter === "boolean") {
    dbQuery.where("is_active", isActiveFilter);
  }

  const inStockFilter = parseBooleanMaybe(requestQuery.in_stock ?? requestQuery.inStock);
  if (inStockFilter !== null && typeof inStockFilter === "boolean") {
    if (inStockFilter) dbQuery.andWhere("stock", ">", 0);
    else dbQuery.andWhere("stock", "<=", 0);
  }

  const rows = await dbQuery;
  return { statusCode: 200, body: { items: rows.map(toInventorySkuPayload) } };
};

const createInventorySkuResponse = async ({ db, payload }) => {
  const body = payload || {};
  const supplierSku = parseNullableText(body.supplierSku ?? body.supplier_sku, { maxLength: 120 });
  const merchType = parseNullableText(body.merchType ?? body.merch_type, { maxLength: 80 });
  const qualityTier = parseNullableText(body.qualityTier ?? body.quality_tier, { maxLength: 80 });
  const size = parseNullableText(body.size, { maxLength: 64 });
  const color = parseNullableText(body.color, { maxLength: 64 });
  const stock = parseNonNegativeInt(body.stock);
  const isActiveRaw = parseBooleanMaybe(body.isActive ?? body.is_active);
  const hasSupplierCostCents =
    typeof body.supplierCostCents !== "undefined" || typeof body.supplier_cost_cents !== "undefined";
  let supplierCostCents = null;
  if (hasSupplierCostCents) {
    const rawSupplierCost = body.supplierCostCents ?? body.supplier_cost_cents;
    if (rawSupplierCost !== null && rawSupplierCost !== "") {
      supplierCostCents = parseNonNegativeInt(rawSupplierCost);
      if (supplierCostCents === null) return { statusCode: 400, body: { error: "invalid_supplier_cost_cents" } };
    }
  }

  const hasMrpCents = typeof body.mrpCents !== "undefined" || typeof body.mrp_cents !== "undefined";
  let mrpCents = null;
  if (hasMrpCents) {
    const rawMrp = body.mrpCents ?? body.mrp_cents;
    if (rawMrp !== null && rawMrp !== "") {
      mrpCents = parseNonNegativeInt(rawMrp);
      if (mrpCents === null) return { statusCode: 400, body: { error: "invalid_mrp_cents" } };
    }
  }

  if (!supplierSku) return { statusCode: 400, body: { error: "supplier_sku_required" } };
  if (!merchType) return { statusCode: 400, body: { error: "merch_type_required" } };
  if (!size) return { statusCode: 400, body: { error: "size_required" } };
  if (!color) return { statusCode: 400, body: { error: "color_required" } };
  if (stock === null) return { statusCode: 400, body: { error: "invalid_stock" } };
  if (isActiveRaw === null) return { statusCode: 400, body: { error: "invalid_is_active" } };

  const [created] = await db("inventory_skus")
    .insert({
      id: randomUUID(),
      supplier_sku: supplierSku,
      merch_type: merchType,
      quality_tier: qualityTier,
      size,
      color,
      stock,
      is_active: typeof isActiveRaw === "boolean" ? isActiveRaw : true,
      supplier_cost_cents: supplierCostCents,
      mrp_cents: mrpCents,
      metadata: db.raw("?::jsonb", [JSON.stringify(body.metadata || {})]),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning([
      "id",
      "supplier_sku",
      "merch_type",
      "quality_tier",
      "size",
      "color",
      "stock",
      "is_active",
      "supplier_cost_cents",
      "mrp_cents",
      "metadata",
      "created_at",
      "updated_at",
    ]);

  return { statusCode: 201, body: { item: toInventorySkuPayload(created) } };
};

const bulkDeactivateInventorySkusResponse = async ({ db, payload }) => {
  const body = payload || {};
  const merchType = parseNullableText(body.merchType ?? body.merch_type, { maxLength: 80 });
  const color = parseNullableText(body.color, { maxLength: 64 });
  const size = parseNullableText(body.size, { maxLength: 64 });
  if (!merchType) return { statusCode: 400, body: { error: "merch_type_required" } };

  const query = db("inventory_skus").where({ merch_type: merchType });
  if (color) query.andWhere({ color });
  if (size) query.andWhere({ size });
  const updatedCount = await query.update({ is_active: false, updated_at: db.fn.now() });
  return { statusCode: 200, body: { ok: true, updatedCount: Number(updatedCount || 0) } };
};

const patchInventorySkuResponse = async ({ db, skuId, payload }) => {
  const current = await db("inventory_skus").where({ id: skuId }).first();
  if (!current) return { statusCode: 404, body: { error: "inventory_sku_not_found" } };

  const body = payload || {};
  const patch = {};
  const supplierSku = parseNullableText(body.supplierSku ?? body.supplier_sku, { maxLength: 120 });
  const merchType = parseNullableText(body.merchType ?? body.merch_type, { maxLength: 80 });
  const qualityTier = parseNullableText(body.qualityTier ?? body.quality_tier, { maxLength: 80 });
  const size = parseNullableText(body.size, { maxLength: 64 });
  const color = parseNullableText(body.color, { maxLength: 64 });
  const parsedIsActive = parseBooleanMaybe(body.isActive ?? body.is_active);
  if (parsedIsActive === null) return { statusCode: 400, body: { error: "invalid_is_active" } };
  if (typeof parsedIsActive === "boolean") patch.is_active = parsedIsActive;
  if (typeof body.supplierSku !== "undefined" || typeof body.supplier_sku !== "undefined") {
    if (!supplierSku) return { statusCode: 400, body: { error: "supplier_sku_required" } };
    patch.supplier_sku = supplierSku;
  }
  if (typeof body.merchType !== "undefined" || typeof body.merch_type !== "undefined") {
    if (!merchType) return { statusCode: 400, body: { error: "merch_type_required" } };
    patch.merch_type = merchType;
  }
  if (typeof body.qualityTier !== "undefined" || typeof body.quality_tier !== "undefined") patch.quality_tier = qualityTier;
  if (typeof body.size !== "undefined") {
    if (!size) return { statusCode: 400, body: { error: "size_required" } };
    patch.size = size;
  }
  if (typeof body.color !== "undefined") {
    if (!color) return { statusCode: 400, body: { error: "color_required" } };
    patch.color = color;
  }

  const stockValueProvided = typeof body.stock !== "undefined" || typeof body.stock_cents !== "undefined";
  const stockDeltaProvided = typeof body.stockDelta !== "undefined" || typeof body.stock_delta !== "undefined";
  if (stockValueProvided && stockDeltaProvided) return { statusCode: 400, body: { error: "stock_and_stock_delta_conflict" } };
  if (stockValueProvided) {
    const parsedStock = parseNonNegativeInt(body.stock ?? body.stock_cents);
    if (parsedStock === null) return { statusCode: 400, body: { error: "invalid_stock" } };
    patch.stock = parsedStock;
  }
  if (stockDeltaProvided) {
    const stockDelta = parseInteger(body.stockDelta ?? body.stock_delta);
    if (stockDelta === null) return { statusCode: 400, body: { error: "invalid_stock_delta" } };
    const nextStock = Number(current.stock ?? 0) + stockDelta;
    if (nextStock < 0) return { statusCode: 400, body: { error: "invalid_stock" } };
    patch.stock = nextStock;
  }

  if (typeof body.supplierCostCents !== "undefined" || typeof body.supplier_cost_cents !== "undefined") {
    const rawSupplierCost = body.supplierCostCents ?? body.supplier_cost_cents;
    if (rawSupplierCost === null || rawSupplierCost === "") patch.supplier_cost_cents = null;
    else {
      const parsed = parseNonNegativeInt(rawSupplierCost);
      if (parsed === null) return { statusCode: 400, body: { error: "invalid_supplier_cost_cents" } };
      patch.supplier_cost_cents = parsed;
    }
  }
  if (typeof body.mrpCents !== "undefined" || typeof body.mrp_cents !== "undefined") {
    const rawMrp = body.mrpCents ?? body.mrp_cents;
    if (rawMrp === null || rawMrp === "") patch.mrp_cents = null;
    else {
      const parsed = parseNonNegativeInt(rawMrp);
      if (parsed === null) return { statusCode: 400, body: { error: "invalid_mrp_cents" } };
      patch.mrp_cents = parsed;
    }
  }
  if (typeof body.metadata !== "undefined") {
    if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) patch.metadata = db.raw("?::jsonb", [JSON.stringify(body.metadata)]);
    else if (body.metadata === null) patch.metadata = db.raw("'{}'::jsonb");
    else return { statusCode: 400, body: { error: "invalid_metadata" } };
  }
  if (Object.keys(patch).length === 0) return { statusCode: 400, body: { error: "no_fields" } };
  patch.updated_at = db.fn.now();

  const [updated] = await db("inventory_skus")
    .where({ id: skuId })
    .update(patch)
    .returning([
      "id",
      "supplier_sku",
      "merch_type",
      "quality_tier",
      "size",
      "color",
      "stock",
      "is_active",
      "supplier_cost_cents",
      "mrp_cents",
      "metadata",
      "created_at",
      "updated_at",
    ]);

  return { statusCode: 200, body: { item: toInventorySkuPayload(updated) } };
};

module.exports = {
  findProductById,
  findVariantById,
  deleteVariantById,
  listVariantsForProduct,
  toInventorySkuPayload,
  parseBooleanMaybe,
  parseInteger,
  parseNonNegativeInt,
  parseNullableText,
  putProductVariantsWorkflow,
  putVariantErrorResponse,
  getProductVariantsResponse,
  deleteVariantResponse,
  listInventorySkusResponse,
  createInventorySkuResponse,
  bulkDeactivateInventorySkusResponse,
  patchInventorySkuResponse,
};
