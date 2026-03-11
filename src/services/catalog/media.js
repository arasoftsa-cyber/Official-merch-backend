const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../../core/db/db");
const { hasTableCached } = require("../../core/db/schemaCache");
const { ensureUploadDir } = require("../../core/config/uploadPaths");
const { toAbsolutePublicUrl } = require("../../utils/publicUrl");
const { PRODUCT_UPLOAD_DIR } = require("./constants");
const { getStorageProvider } = require("../../storage");
const { finalizeUploadedMedia } = require("../../storage/mediaUploadLifecycle");
const { createMediaAsset } = require("../mediaAssets.service");
const storageProvider = getStorageProvider();

const saveProductListingPhotos = async ({ trx, productId, files = [] }) => {
  return saveProductMediaFiles({ trx, productId, files, role: "listing_photo" });
};

const saveProductMediaFiles = async ({ trx, productId, files = [], role = "listing_photo" }) => {
  ensureUploadDir("products");
  const urls = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const extRaw = path.extname(file.originalname || "").slice(0, 12);
    const ext = /^[.][a-z0-9]+$/i.test(extRaw) ? extRaw.toLowerCase() : "";
    const filename = `${Date.now()}-${randomUUID()}${ext}`;
    const relativePath = path.posix.join("products", filename);
    const saved = await storageProvider.saveFile({
      relativePath,
      buffer: file.buffer,
    });
    const storageResult = await finalizeUploadedMedia({ saved, file, relativePath });
    const publicUrl = storageResult.publicUrl;
    const mediaAssetId = randomUUID();
    await createMediaAsset({
      trx,
      id: mediaAssetId,
      publicUrl,
      storageMetadata: storageResult,
    });

    await trx("entity_media_links").insert({
      id: randomUUID(),
      media_asset_id: mediaAssetId,
      entity_type: "product",
      entity_id: productId,
      role,
      sort_order: index,
      created_at: trx.fn.now(),
    });

    urls.push(publicUrl);
  }

  return urls;
};

const loadProductListingPhotos = async (productId) => {
  return loadProductMediaByRole({ productId, role: "listing_photo" });
};

const loadProductMediaByRoleMap = async ({ productIds = [], role }) => {
  const normalizedProductIds = Array.from(new Set((productIds || []).filter(Boolean)));
  const byProductId = new Map();
  for (const productId of normalizedProductIds) {
    byProductId.set(productId, []);
  }

  if (!role || normalizedProductIds.length === 0) return byProductId;

  const db = getDb();
  const [hasEntityMediaLinks, hasMediaAssets] = await Promise.all([
    hasTableCached(db, "entity_media_links"),
    hasTableCached(db, "media_assets"),
  ]);
  if (!hasEntityMediaLinks || !hasMediaAssets) return byProductId;

  const rows = await db("entity_media_links as eml")
    .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
    .where("eml.entity_type", "product")
    .whereIn("eml.entity_id", normalizedProductIds)
    .andWhere("eml.role", role)
    .orderBy("eml.entity_id", "asc")
    .orderBy("eml.sort_order", "asc")
    .select("eml.entity_id", "ma.public_url");

  for (const row of rows) {
    const key = row.entity_id;
    if (!byProductId.has(key)) byProductId.set(key, []);
    const normalizedUrl = toAbsolutePublicUrl(row.public_url);
    if (normalizedUrl) byProductId.get(key).push(normalizedUrl);
  }

  return byProductId;
};

const loadProductMediaByRole = async ({ productId, role }) => {
  if (!productId) return [];
  const map = await loadProductMediaByRoleMap({ productIds: [productId], role });
  return map.get(productId) || [];
};

const loadProductDesignImagesMap = async (productIds = []) => {
  const grouped = await loadProductMediaByRoleMap({
    productIds,
    role: "design_image",
  });
  const byProductId = new Map();
  for (const [productId, urls] of grouped.entries()) {
    byProductId.set(productId, Array.isArray(urls) ? urls[0] || "" : "");
  }
  return byProductId;
};

const loadProductDesignImage = async (productId) => {
  if (!productId) return "";
  const designImageMap = await loadProductDesignImagesMap([productId]);
  return designImageMap.get(productId) || "";
};

const attachListingPhotosToProducts = async (products = []) => {
  if (!Array.isArray(products) || products.length === 0) return products;

  const productIds = products.map((p) => p.id).filter(Boolean);
  const byProductId = await loadProductMediaByRoleMap({
    productIds,
    role: "listing_photo",
  });

  return products.map((product) => ({
    ...product,
    listingPhotoUrls: byProductId.get(product.id) || [],
    listing_photos: byProductId.get(product.id) || [],
    photoUrls: byProductId.get(product.id) || [],
    photos: byProductId.get(product.id) || [],
    listingPhotoUrl: (byProductId.get(product.id) || [])[0] || "",
    primaryPhotoUrl: (byProductId.get(product.id) || [])[0] || "",
    cover_photo_url: (byProductId.get(product.id) || [])[0] || null,
  }));
};

const replaceProductListingPhotos = async ({ trx, productId, files = [] }) => {
  return replaceProductMediaByRole({
    trx,
    productId,
    files,
    role: "listing_photo",
  });
};

const replaceProductMediaByRole = async ({ trx, productId, files = [], role }) => {
  await trx("entity_media_links")
    .where({
      entity_type: "product",
      entity_id: productId,
      role,
    })
    .delete();

  return saveProductMediaFiles({
    trx,
    productId,
    files,
    role,
  });
};

const saveProductDesignImage = async ({ trx, productId, file }) => {
  if (!file) return "";
  const urls = await replaceProductMediaByRole({
    trx,
    productId,
    files: [file],
    role: "design_image",
  });
  return urls[0] || "";
};

module.exports = {
  saveProductListingPhotos,
  replaceProductListingPhotos,
  loadProductListingPhotos,
  saveProductDesignImage,
  loadProductDesignImage,
  loadProductDesignImagesMap,
  attachListingPhotosToProducts,
};

