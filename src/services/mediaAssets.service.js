"use strict";

const { randomUUID } = require("crypto");
const { normalizeUploadStatus } = require("../storage/uploadStatus");

const buildMediaAssetInsertPayload = async ({
  trx,
  id = randomUUID(),
  publicUrl,
  storageMetadata = {},
} = {}) => {
  if (!trx) throw new Error("media_asset_transaction_required");

  const columns = await trx("media_assets").columnInfo();
  const hasColumn = (name) => Object.prototype.hasOwnProperty.call(columns, name);
  const payload = {
    id,
    public_url: publicUrl,
  };

  if (hasColumn("created_at")) {
    payload.created_at = trx.fn.now();
  }
  if (hasColumn("status")) {
    payload.status = normalizeUploadStatus(storageMetadata.status);
  }
  if (hasColumn("storage_key")) {
    payload.storage_key = storageMetadata.storageKey || null;
  }
  if (hasColumn("provider")) {
    payload.provider = storageMetadata.provider || null;
  }
  if (hasColumn("mime_type")) {
    payload.mime_type = storageMetadata.mimeType || null;
  }
  if (hasColumn("size_bytes")) {
    payload.size_bytes =
      typeof storageMetadata.size === "number" ? storageMetadata.size : null;
  }
  if (hasColumn("original_filename")) {
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
