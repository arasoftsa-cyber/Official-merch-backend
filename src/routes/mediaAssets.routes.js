const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { requireAuth } = require("../core/http/auth.middleware");
const { requirePolicy } = require("../core/http/policy.middleware");
const { createMultipartUploadMiddleware } = require("../middleware/uploadMultipart");
const { getStorageProvider } = require("../storage");
const { finalizeUploadedMedia } = require("../storage/mediaUploadLifecycle");
const { createMediaAsset } = require("../services/mediaAssets.service");
const { toAbsolutePublicUrl } = require("../utils/publicUrl");

const router = express.Router();
const storageProvider = getStorageProvider();
const requireMediaUploadWrite = requirePolicy("admin_dashboard:write", "media_assets");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_MULTIPART_BYTES = 5 * 1024 * 1024;
const MAX_FILE_SIZE = 5 * 1024;
const EXPECTED_FILE_FIELD = "file";

const MAGIC_NUMBERS = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
  "image/gif": [0x47, 0x49, 0x46],
};

const validateFileBuffer = (buffer, declaredMimeType) => {
  if (buffer.length > MAX_FILE_SIZE) {
    return false;
  }

  const magic = MAGIC_NUMBERS[declaredMimeType];
  if (!magic) return false;

  for (let i = 0; i < magic.length; i += 1) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
};

const parseMediaUpload = createMultipartUploadMiddleware({
  fileFields: [EXPECTED_FILE_FIELD],
  errorField: EXPECTED_FILE_FIELD,
  maxBytes: MAX_MULTIPART_BYTES,
  maxFileSize: MAX_FILE_SIZE,
  allowedMimeTypes: ALLOWED_MIME_TYPES,
  validateFile: (file) => validateFileBuffer(file.buffer, file.mimetype),
});

const sanitizeExt = (filename) => {
  const originalExt = path.extname(filename || "").slice(0, 12);
  return /^[.][a-z0-9]+$/i.test(originalExt) ? originalExt.toLowerCase() : "";
};

const saveUploadedFile = async (file) => {
  const ext = sanitizeExt(file.originalname);
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const relativePath = path.posix.join("media-assets", filename);
  const saved = await storageProvider.saveFile({
    relativePath,
    buffer: file.buffer,
  });
  return finalizeUploadedMedia({ saved, file, relativePath });
};

router.post("/", requireAuth, requireMediaUploadWrite, parseMediaUpload, async (req, res) => {
  try {
    const upload = req.uploadMultipart.file;
    const storageResult = await saveUploadedFile(upload);
    const publicUrl = toAbsolutePublicUrl(storageResult.publicUrl);
    const id = randomUUID();

    const db = getDb();
    await createMediaAsset({
      trx: db,
      id,
      publicUrl,
      storageMetadata: storageResult,
    });

    return res.status(201).json({ id, publicUrl });
  } catch (err) {
    console.error("[media-assets] upload failed", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

module.exports = router;
