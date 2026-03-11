const { randomUUID } = require("crypto");
const { getDb } = require("../../core/db/db");
const { resolveOurShareCents } = require("../../utils/economics");
const { parseNonNegativeInt, buildTransitionalSupplierSku } = require("./helpers");

const createProductWithVariants = async (input) => {
  const db = getDb();
  return db.transaction(async (trx) => {
    const productId = randomUUID();
    const [productColumns, variantColumns, skuColumns] = await Promise.all([
      trx("products").columnInfo(),
      trx("product_variants").columnInfo(),
      trx("inventory_skus").columnInfo(),
    ]);

    const hasProductColumn = (name) => Object.prototype.hasOwnProperty.call(productColumns, name);
    const hasVariantColumn = (name) => Object.prototype.hasOwnProperty.call(variantColumns, name);
    const hasSkuColumn = (name) => Object.prototype.hasOwnProperty.call(skuColumns, name);
    const normalizedRequestedStatus = ["pending", "inactive", "active", "rejected"].includes(
      String(input?.status || "")
        .trim()
        .toLowerCase()
    )
      ? String(input.status).trim().toLowerCase()
      : null;
    const resolvedStatus =
      normalizedRequestedStatus ||
      ((input.isActive === undefined ? true : Boolean(input.isActive)) ? "active" : "inactive");

    const productInsert = {
      id: productId,
      artist_id: input.artistId,
      title: input.title,
      description: input.description || null,
      is_active: resolvedStatus === "active",
    };
    if (hasProductColumn("status")) {
      productInsert.status = resolvedStatus;
    }
    if (hasProductColumn("rejection_reason") && resolvedStatus !== "rejected") {
      productInsert.rejection_reason = null;
    }

    await trx("products").insert(productInsert);

    const variantRows = [];
    const seenSupplierSkus = new Set();
    for (let index = 0; index < input.variants.length; index += 1) {
      const variant = input.variants[index] || {};
      const stock = parseNonNegativeInt(variant.stock) ?? 0;
      const size = String(variant.size || "default").trim() || "default";
      const color = String(variant.color || "default").trim() || "default";
      const merchType = String(variant.merchType || variant.merch_type || "default").trim() || "default";
      const inventorySkuIdInput = String(
        variant.inventorySkuId || variant.inventory_sku_id || ""
      ).trim();

      let inventorySkuId = inventorySkuIdInput || null;
      if (inventorySkuId) {
        const existingSku = await trx("inventory_skus").where({ id: inventorySkuId }).first("id");
        if (!existingSku) {
          throw Object.assign(new Error("inventory_sku_not_found"), { code: "INVENTORY_SKU_NOT_FOUND" });
        }
      } else {
        let supplierSku = String(variant.supplierSku || variant.supplier_sku || "").trim();
        if (!supplierSku) {
          supplierSku = buildTransitionalSupplierSku({ productId, variant, index });
        }
        if (seenSupplierSkus.has(supplierSku)) {
          supplierSku = `${supplierSku}-${String(randomUUID()).slice(0, 8).toUpperCase()}`;
        }
        seenSupplierSkus.add(supplierSku);

        const skuInsert = {
          id: randomUUID(),
          supplier_sku: supplierSku,
          merch_type: merchType,
          quality_tier: variant.qualityTier || variant.quality_tier || null,
          size,
          color,
          stock,
          is_active: true,
          metadata: trx.raw("?::jsonb", [JSON.stringify({ source: "createProductWithVariants" })]),
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        };

        if (hasSkuColumn("supplier_cost_cents")) {
          skuInsert.supplier_cost_cents = parseNonNegativeInt(
            variant.supplierCostCents ?? variant.supplier_cost_cents
          );
        }
        if (hasSkuColumn("mrp_cents")) {
          skuInsert.mrp_cents = parseNonNegativeInt(variant.mrpCents ?? variant.mrp_cents);
        }

        const [createdSku] = await trx("inventory_skus")
          .insert(skuInsert)
          .returning("id");
        inventorySkuId = createdSku?.id || skuInsert.id;
      }

      const priceCents = parseNonNegativeInt(variant.priceCents ?? variant.price_cents);
      if (priceCents === null) {
        throw Object.assign(new Error("invalid_price"), { code: "INVALID_VARIANT_PRICE" });
      }
      const vendorPayoutCents = parseNonNegativeInt(
        variant.vendorPayoutCents ?? variant.vendor_payout_cents
      );
      const royaltyCents = parseNonNegativeInt(
        variant.royaltyCents ?? variant.royalty_cents
      );
      const ourShareParsed = parseNonNegativeInt(
        variant.ourShareCents ?? variant.our_share_cents
      );
      const shareResolution = resolveOurShareCents({
        sellingPriceCents: priceCents,
        vendorPayoutCents:
          vendorPayoutCents === null ? undefined : vendorPayoutCents,
        royaltyCents: royaltyCents === null ? undefined : royaltyCents,
        ourShareCents: ourShareParsed === null ? undefined : ourShareParsed,
      });
      if (shareResolution.error) {
        throw Object.assign(new Error(shareResolution.error), {
          code: "INVALID_VARIANT_ECONOMICS",
        });
      }
      if (
        ourShareParsed === null &&
        vendorPayoutCents !== null &&
        royaltyCents !== null &&
        typeof shareResolution.ourShareCents !== "number"
      ) {
        throw Object.assign(new Error("invalid_our_share_cents"), {
          code: "INVALID_VARIANT_ECONOMICS",
        });
      }

      const variantInsert = {
        id: randomUUID(),
        product_id: productId,
        sku: String(variant.sku || `SKU-${String(productId).slice(0, 8)}-${index + 1}`).trim(),
        size,
        color,
        price_cents: priceCents,
        created_at: trx.fn.now(),
      };
      if (hasVariantColumn("inventory_sku_id")) {
        variantInsert.inventory_sku_id = inventorySkuId;
      }
      if (hasVariantColumn("is_listed")) {
        variantInsert.is_listed = variant.isListed !== false;
      }
      if (hasVariantColumn("selling_price_cents")) {
        variantInsert.selling_price_cents = priceCents;
      }
      if (hasVariantColumn("vendor_payout_cents") && vendorPayoutCents !== null) {
        variantInsert.vendor_payout_cents = vendorPayoutCents;
      }
      if (hasVariantColumn("royalty_cents") && royaltyCents !== null) {
        variantInsert.royalty_cents = royaltyCents;
      }
      if (
        hasVariantColumn("our_share_cents") &&
        typeof shareResolution.ourShareCents === "number"
      ) {
        variantInsert.our_share_cents = shareResolution.ourShareCents;
      }
      if (hasVariantColumn("stock")) {
        // Compatibility mirror only; source of truth is inventory_skus.stock.
        variantInsert.stock = stock;
      }
      if (hasVariantColumn("updated_at")) {
        variantInsert.updated_at = trx.fn.now();
      }
      variantRows.push(variantInsert);
    }

    await trx("product_variants").insert(variantRows);

    return productId;
  });
};

module.exports = {
  createProductWithVariants,
};

