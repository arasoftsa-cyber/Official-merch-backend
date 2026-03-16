"use strict";

const { randomUUID } = require("crypto");
const { assertMediaAssetWriteSchema } = require("../core/db/schemaContract");
const { normalizeUploadStatus } = require("../storage/uploadStatus");

const buildMediaAssetInsertPayload = async ({
  trx,
  id = randomUUID(),
  publicUrl,
  storageMetadata = {},
} = {}) => {
  if (!trx) throw new Error("media_asset_transaction_required");
  let mediaAssetColumns;
  try {
    mediaAssetColumns = await assertMediaAssetWriteSchema(trx);
  } catch (error) {
    if (error?.code === "SCHEMA_CONTRACT_MISSING") {
      const schemaError = new Error("media_assets_table_not_ready");
      schemaError.code = error.code;
      schemaError.statusCode = error.statusCode || 500;
      schemaError.details = error.details || [];
      throw schemaError;
    }
    throw error;
  }

  const payload = {
    id,
    public_url: publicUrl,
  };
  if (Object.prototype.hasOwnProperty.call(mediaAssetColumns, "created_at")) {
    payload.created_at = trx.fn.now();
  }
  if (Object.prototype.hasOwnProperty.call(mediaAssetColumns, "status")) {
    payload.status = normalizeUploadStatus(storageMetadata.status);
  }
  if (Object.prototype.hasOwnProperty.call(mediaAssetColumns, "storage_key")) {
    payload.storage_key = storageMetadata.storageKey || null;
  }
  if (Object.prototype.hasOwnProperty.call(mediaAssetColumns, "provider")) {
    payload.provider = storageMetadata.provider || null;
  }
  if (Object.prototype.hasOwnProperty.call(mediaAssetColumns, "mime_type")) {
    payload.mime_type = storageMetadata.mimeType || null;
  }
  if (Object.prototype.hasOwnProperty.call(mediaAssetColumns, "size_bytes")) {
    payload.size_bytes =
      typeof storageMetadata.size === "number" ? storageMetadata.size : null;
  }
  if (Object.prototype.hasOwnProperty.call(mediaAssetColumns, "original_filename")) {
    payload.original_filename = storageMetadata.originalFilename || null;
  }

  return payload;
};

const createMediaAsset = async ({
  trx,
  id = randomUUID(),
  publicUrl,
  storageMetadata = {},
} = {}) => {
  const payload = await buildMediaAssetInsertPayload({
    trx,
    id,
    publicUrl,
    storageMetadata,
  });
  await trx("media_assets").insert(payload);
  return {
    id: payload.id,
    publicUrl: payload.public_url,
    status: normalizeUploadStatus(payload.status || storageMetadata.status),
  };
};

module.exports = {
  createMediaAsset,
  buildMediaAssetInsertPayload,
};
