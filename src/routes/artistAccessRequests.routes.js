const express = require("express");
const {
  submitArtistAccessRequest,
  checkArtistAccessAvailability,
  PROFILE_PHOTO_UPLOAD_FIELDS,
  MAX_PROFILE_PHOTO_UPLOAD_BYTES,
  ALLOWED_PROFILE_PHOTO_MIME_TYPES,
  isValidProfilePhotoUpload,
} = require("../services/artistAccessRequests.service");
const { createMultipartUploadMiddleware } = require("../middleware/uploadMultipart");
const {
  normalizeArtistAccessCheckQuery,
  validateArtistAccessCheckQuery,
  normalizeArtistAccessSubmissionPayload,
  validateArtistAccessSubmissionPayload,
} = require("../contracts/artistAccessRequest.contract");
const { logLegacyContractUse } = require("../contracts/shared");

const router = express.Router();
const MAX_MULTIPART_BYTES = 2 * 1024 * 1024;

const buildValidationPayload = (field, message) => ({
  error: "validation",
  details: [{ field, message }],
});

const parseArtistAccessMultipart = createMultipartUploadMiddleware({
  fileFields: PROFILE_PHOTO_UPLOAD_FIELDS,
  errorField: "profile_photo",
  attachKey: "artistAccessUpload",
  optionalFile: true,
  maxBytes: MAX_MULTIPART_BYTES,
  maxFileSize: MAX_PROFILE_PHOTO_UPLOAD_BYTES,
  allowedMimeTypes: ALLOWED_PROFILE_PHOTO_MIME_TYPES,
  validateFile: (file) => isValidProfilePhotoUpload(file),
  buildErrorPayload: ({ field, reason }) => {
    if (reason === "parse_error" || reason === "missing_multipart") {
      return buildValidationPayload("body", "invalid multipart payload");
    }
    if (field === "profile_photo") {
      return buildValidationPayload("profile_photo", "profile_photo is invalid");
    }
    return buildValidationPayload("body", "invalid multipart payload");
  },
});

router.get("/check", async (req, res) => {
  try {
    const { dto } = normalizeArtistAccessCheckQuery(req.query || {});
    const query = validateArtistAccessCheckQuery(dto);

    let field = null;
    let value = "";
    if (query.handle) {
      field = "handle";
      value = query.handle;
    } else if (query.email) {
      field = "email";
      value = query.email;
    } else if (query.phone) {
      field = "phone";
      value = query.phone;
    }

    const result = await checkArtistAccessAvailability({ field, value });
    return res.status(200).json(result);
  } catch (error) {
    if (error?.code === "validation") {
      return res.status(400).json({ error: "validation", details: error.details || [] });
    }
    return res.status(500).json({ error: "internal_server_error" });
  }
});

router.post("/", parseArtistAccessMultipart, async (req, res) => {
  try {
    const upload = req.artistAccessUpload || { fields: req.body || {}, file: null };
    const { dto, meta } = normalizeArtistAccessSubmissionPayload(upload.fields || req.body || {});
    validateArtistAccessSubmissionPayload(dto);
    logLegacyContractUse({
      workflow: "artist_access_requests.create",
      legacyKeys: meta.legacyKeys,
    });

    const result = await submitArtistAccessRequest({ rawBody: dto, file: upload.file || null });
    return res
      .status(201)
      .json({ ok: true, request_id: result.request_id, created_at: result.created_at });
  } catch (error) {
    if (error?.code === "validation") {
      return res.status(400).json({ error: "validation", details: error.details || [] });
    }
    if (error?.code === "conflict") {
      return res.status(409).json({ error: "conflict", field: error.field || "email" });
    }
    console.error(error);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

module.exports = router;
