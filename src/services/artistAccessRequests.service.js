const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { getStorageProvider } = require("../storage");
const { finalizeUploadedMedia } = require("../storage/mediaUploadLifecycle");
const { createMediaAsset } = require("./mediaAssets.service");
const {
  assertArtistAccessRequestSubmissionSchema,
  assertArtistAccessRequestMediaSchema,
} = require("../core/db/schemaContract");
const { toAbsolutePublicUrl } = require("../utils/publicUrl");
const { PLAN_TYPES, assertPlanAllowed } = require("../common/constants");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const HANDLE_RE = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const PROFILE_PHOTO_UPLOAD_FIELDS = Object.freeze(["profile_photo", "profilePhoto"]);
const PROFILE_PHOTO_FIELDS = new Set(PROFILE_PHOTO_UPLOAD_FIELDS);
const MAX_PROFILE_PHOTO_UPLOAD_BYTES = 1024 * 1024;
const ALLOWED_PROFILE_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROFILE_PHOTO_MAGIC_NUMBERS = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
};
const storageProvider = getStorageProvider();
const ARTIST_ACCESS_REQUEST_DEBUG_ENABLED = process.env.DEBUG_ARTIST_ACCESS_REQUESTS === "1";

const LIMITS = {
  artistName: 120,
  handle: 60,
  email: 254,
  phone: 20,
  about: 2500,
  messageForFans: 2500,
  socials: 5,
  socialPlatform: 40,
  socialUrl: 400,
};

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const logArtistAccessRequestDebug = (event, metadata = {}) => {
  if (!ARTIST_ACCESS_REQUEST_DEBUG_ENABLED) return;
  console.info(
    JSON.stringify({
      scope: "artist_access_request",
      event,
      ...metadata,
    })
  );
};

const addDetail = (details, field, message) => details.push({ field, message });

const validationError = (details) => {
  const err = new Error("validation");
  err.code = "validation";
  err.details = details;
  return err;
};

const normalizePhoneDigits = (value) => trim(value).replace(/\D+/g, "");
const normalizeHandle = (value) => trim(value).replace(/^@+/, "").toLowerCase();
const normalizeEmail = (value) => trim(value).toLowerCase();
const normalizeTrustedContext = (value) => {
  const requestorUserId = trim(value?.requestorUserId);
  if (!requestorUserId) return null;
  return {
    requestorUserId: requestorUserId || null,
  };
};

const normalizeSocials = (input) => {
  if (!input) return [];

  let val = input;

  if (Buffer.isBuffer(val)) {
    val = val.toString("utf8");
  }

  if (typeof val === "string") {
    let s = val.trim();
    if (s === "[object Object]") return [];
    try {
      val = JSON.parse(s);
    } catch {
      try {
        val = JSON.parse(s.replace(/\\"/g, '"'));
      } catch {
        return [];
      }
    }
  }

  if (!Array.isArray(val)) return [];

  const out = [];
  for (const row of val) {
    if (!row) continue;
    const platform = String(row.platform || "").trim();
    const url = String(row.url || "").trim();
    if (!platform || !url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ platform, url });
  }

  return out.slice(0, 5);
};

const normalizePayload = (rawBody = {}) => {
  const hasPaymentFields = [
    "payment_mode",
    "paymentMode",
    "transaction_id",
    "transactionId",
  ].some((key) => Object.prototype.hasOwnProperty.call(rawBody, key));

  return {
    artist_name: trim(rawBody.artist_name || rawBody.artistName),
    handle: normalizeHandle(rawBody.handle),
    email: normalizeEmail(rawBody.email || rawBody.contact_email || rawBody.contactEmail),
    phone: normalizePhoneDigits(rawBody.phone || rawBody.contact_phone || rawBody.contactPhone),
    about: trim(rawBody.about || rawBody.about_me || rawBody.aboutMe || rawBody.pitch),
    message_for_fans: trim(
      rawBody.message_for_fans || rawBody.messageForFans || rawBody.fan_message
    ),
    socials: rawBody.socials,
    requested_plan_type_input:
      rawBody.requested_plan_type ?? rawBody.planType ?? rawBody.requestedPlanType,
    has_payment_fields: hasPaymentFields,
  };
};

const conflictError = (field) => {
  const err = new Error("conflict");
  err.code = "conflict";
  err.field = field;
  return err;
};

const validatePayload = (payload) => {
  const details = [];

  if (!payload.artist_name) addDetail(details, "artist_name", "artist_name is required");
  if (!payload.handle) addDetail(details, "handle", "handle is required");
  if (!payload.email) addDetail(details, "email", "email is required");
  if (!payload.phone) addDetail(details, "phone", "phone is required");
  if (!trim(payload.requested_plan_type_input)) {
    addDetail(details, "requested_plan_type", "requested_plan_type is required");
  }
  if (payload.has_payment_fields) {
    addDetail(
      details,
      "payment",
      "payment_mode and transaction_id are not accepted at submission stage"
    );
  }

  if (payload.artist_name && payload.artist_name.length < 2) {
    addDetail(details, "artist_name", "artist_name must be at least 2 characters");
  }
  if (payload.artist_name.length > LIMITS.artistName) {
    addDetail(details, "artist_name", `artist_name max length is ${LIMITS.artistName}`);
  }
  if (payload.handle && !HANDLE_RE.test(payload.handle)) {
    addDetail(details, "handle", "handle must be slug-like");
  }
  if (payload.handle.length > LIMITS.handle) {
    addDetail(details, "handle", `handle max length is ${LIMITS.handle}`);
  }
  if (payload.email && !EMAIL_RE.test(payload.email)) {
    addDetail(details, "email", "email must be valid");
  }
  if (payload.email.length > LIMITS.email) {
    addDetail(details, "email", `email max length is ${LIMITS.email}`);
  }
  if (payload.phone && payload.phone.length < 7) {
    addDetail(details, "phone", "phone must have at least 7 digits");
  }
  if (payload.phone.length > LIMITS.phone) {
    addDetail(details, "phone", `phone max length is ${LIMITS.phone}`);
  }
  if (payload.about.length > LIMITS.about) {
    addDetail(details, "about", `about max length is ${LIMITS.about}`);
  }
  if (payload.message_for_fans.length > LIMITS.messageForFans) {
    addDetail(
      details,
      "message_for_fans",
      `message_for_fans max length is ${LIMITS.messageForFans}`
    );
  }

  return details;
};

const existsInArtistAccessRequests = async (db, field, value) => {
  if (field === "phone") {
    const hit = await db("artist_access_requests")
      .whereRaw("regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ?", [value])
      .first("id");
    return Boolean(hit);
  }
  const hit = await db("artist_access_requests")
    .whereRaw(`lower(trim(${field})) = lower(trim(?))`, [value])
    .first("id");
  return Boolean(hit);
};

const existsInArtistsByHandle = async (db, handle) => {
  const hit = await db("artists")
    .whereRaw("lower(trim(handle)) = lower(trim(?))", [handle])
    .first("id");
  return Boolean(hit);
};

const existsInUsersByEmail = async (db, email) => {
  const hit = await db("users")
    .whereRaw("lower(trim(email)) = lower(trim(?))", [email])
    .first("id");
  return Boolean(hit);
};

const findConflictField = async (db, payload) => {
  if (await existsInArtistAccessRequests(db, "handle", payload.handle)) return "handle";
  if (await existsInArtistsByHandle(db, payload.handle)) return "handle";
  if (await existsInArtistAccessRequests(db, "email", payload.email)) return "email";
  if (await existsInUsersByEmail(db, payload.email)) return "email";
  if (await existsInArtistAccessRequests(db, "phone", payload.phone)) return "phone";
  return null;
};

const mapUniqueViolationToField = (error) => {
  const detail = `${error?.detail || ""} ${error?.constraint || ""}`.toLowerCase();
  if (detail.includes("handle")) return "handle";
  if (detail.includes("email")) return "email";
  if (detail.includes("phone")) return "phone";
  return null;
};

const isValidProfilePhotoBuffer = (buffer, mimetype) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  if (buffer.length > MAX_PROFILE_PHOTO_UPLOAD_BYTES) return false;

  const magic = PROFILE_PHOTO_MAGIC_NUMBERS[mimetype];
  if (!magic) return false;

  for (let i = 0; i < magic.length; i += 1) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
};

const isValidProfilePhotoUpload = (file) => {
  if (!file) return false;
  if (!PROFILE_PHOTO_FIELDS.has(file.fieldname)) return false;
  if (!ALLOWED_PROFILE_PHOTO_MIME_TYPES.has(file.mimetype)) return false;
  return isValidProfilePhotoBuffer(file.buffer, file.mimetype);
};

const saveUploadedFile = async (file) => {
  if (!isValidProfilePhotoUpload(file)) return null;

  const originalExt = path.extname(file.originalname || "").slice(0, 12);
  const ext = /^[.][a-z0-9]+$/i.test(originalExt) ? originalExt : "";
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const relativePath = path.posix.join("artist-access-requests", filename);
  const saved = await storageProvider.saveFile({
    relativePath,
    buffer: file.buffer,
  });
  const storageResult = await finalizeUploadedMedia({ saved, file, relativePath });
  return storageResult.publicUrl;
};

const submitArtistAccessRequest = async ({ rawBody = {}, file = null, trustedContext = null }) => {
  const payload = normalizePayload(rawBody);
  const socialsArr = normalizeSocials(payload.socials);
  const trusted = normalizeTrustedContext(trustedContext);

  const details = validatePayload(payload);
  if (details.length > 0) {
    throw validationError(details);
  }
  let requestedPlanType = PLAN_TYPES.BASIC;
  try {
    requestedPlanType = assertPlanAllowed(payload.requested_plan_type_input, {
      fieldName: "requested_plan_type",
    });
  } catch (error) {
    throw validationError([
      {
        field: "requested_plan_type",
        message: error?.message || "requested_plan_type is invalid",
      },
    ]);
  }
  if (file && !PROFILE_PHOTO_FIELDS.has(file.fieldname)) {
    throw validationError([
      { field: "profile_photo", message: "profile_photo field name is invalid" },
    ]);
  }
  if (file && file.buffer?.length > MAX_PROFILE_PHOTO_UPLOAD_BYTES) {
    throw validationError([
      {
        field: "profile_photo",
        message: `profile_photo max size is ${MAX_PROFILE_PHOTO_UPLOAD_BYTES} bytes`,
      },
    ]);
  }
  if (file && !isValidProfilePhotoUpload(file)) {
    throw validationError([
      { field: "profile_photo", message: "profile_photo file type is invalid" },
    ]);
  }

  const db = getDb();
  const submissionSchema = await assertArtistAccessRequestSubmissionSchema(db);
  const preConflictField = await findConflictField(db, payload);
  if (preConflictField) {
    throw conflictError(preConflictField);
  }

  const requestId = randomUUID();
  const mediaSchema = file ? await assertArtistAccessRequestMediaSchema(db) : null;
  try {
    const [createdRow] = await db.transaction(async (trx) => {
      const requestColumns = submissionSchema.requestColumns;
      const insertPayload = {
        id: requestId,
        artist_name: payload.artist_name,
        handle: payload.handle,
        email: payload.email,
        phone: payload.phone,
        socials: trx.raw("?::jsonb", [JSON.stringify(socialsArr)]),
      };

      if (Object.prototype.hasOwnProperty.call(requestColumns, "about_me")) {
        insertPayload.about_me = payload.about || null;
      }
      if (Object.prototype.hasOwnProperty.call(requestColumns, "message_for_fans")) {
        insertPayload.message_for_fans = payload.message_for_fans || null;
      }
      if (Object.prototype.hasOwnProperty.call(requestColumns, "about")) {
        insertPayload.about = payload.about || null;
      }
      if (Object.prototype.hasOwnProperty.call(requestColumns, "contact_email")) {
        insertPayload.contact_email = payload.email;
      }
      if (Object.prototype.hasOwnProperty.call(requestColumns, "contact_phone")) {
        insertPayload.contact_phone = payload.phone;
      }
      if (Object.prototype.hasOwnProperty.call(requestColumns, "pitch")) {
        insertPayload.pitch = payload.about || null;
      }
      if (Object.prototype.hasOwnProperty.call(requestColumns, "status")) {
        insertPayload.status = "pending";
      }
      if (Object.prototype.hasOwnProperty.call(requestColumns, "requested_plan_type")) {
        insertPayload.requested_plan_type = requestedPlanType;
      }
      if (
        trusted?.requestorUserId &&
        Object.prototype.hasOwnProperty.call(requestColumns, "requestor_user_id")
      ) {
        insertPayload.requestor_user_id = trusted.requestorUserId;
      }
      if (Object.prototype.hasOwnProperty.call(requestColumns, "created_at")) {
        insertPayload.created_at = trx.fn.now();
      }
      if (Object.prototype.hasOwnProperty.call(requestColumns, "updated_at")) {
        insertPayload.updated_at = trx.fn.now();
      }

      const insertedRows = await trx("artist_access_requests")
        .insert(insertPayload)
        .returning(["id", "created_at"]);
      const inserted = insertedRows?.[0] || { id: requestId, created_at: new Date().toISOString() };

      if (file) {
        const publicPath = await saveUploadedFile(file);
        if (publicPath) {
          const publicUrl = toAbsolutePublicUrl(publicPath);
          const mediaAssetId = randomUUID();
          await createMediaAsset({
            trx,
            id: mediaAssetId,
            publicUrl,
          });
          const linkInsert = {
            media_asset_id: mediaAssetId,
            entity_type: "artist_access_request",
            entity_id: requestId,
            role: "profile_photo",
            sort_order: 0,
          };
          if (Object.prototype.hasOwnProperty.call(mediaSchema.entityMediaLinkColumns, "id")) {
            linkInsert.id = randomUUID();
          }
          if (
            Object.prototype.hasOwnProperty.call(mediaSchema.entityMediaLinkColumns, "created_at")
          ) {
            linkInsert.created_at = trx.fn.now();
          }
          await trx("entity_media_links").insert(linkInsert);

          const requestUpdates = {};
          if (Object.prototype.hasOwnProperty.call(requestColumns, "profile_photo_path")) {
            requestUpdates.profile_photo_path = publicUrl;
          }
          if (Object.prototype.hasOwnProperty.call(requestColumns, "profile_photo_url")) {
            requestUpdates.profile_photo_url = publicUrl;
          }
          if (Object.keys(requestUpdates).length > 0) {
            await trx("artist_access_requests").where({ id: requestId }).update(requestUpdates);
          }
        }
      }

      return [inserted];
    });

    logArtistAccessRequestDebug("submitted", {
      requestId,
      hasProfilePhoto: Boolean(file),
    });

    return {
      request_id: requestId,
      created_at: createdRow?.created_at || new Date().toISOString(),
    };
  } catch (error) {
    logArtistAccessRequestDebug("submit_failed", {
      requestId,
      code: error?.code || "unknown",
    });
    if (error?.code === "23505") {
      const field = mapUniqueViolationToField(error) || (await findConflictField(db, payload)) || "email";
      throw conflictError(field);
    }
    throw error;
  }
};

const checkArtistAccessAvailability = async ({ field, value }) => {
  const db = getDb();
  if (field === "handle") {
    const unavailable =
      (await existsInArtistAccessRequests(db, "handle", value)) || (await existsInArtistsByHandle(db, value));
    return { field, available: !unavailable };
  }
  if (field === "email") {
    const unavailable =
      (await existsInArtistAccessRequests(db, "email", value)) || (await existsInUsersByEmail(db, value));
    return { field, available: !unavailable };
  }
  if (field === "phone") {
    const unavailable = await existsInArtistAccessRequests(db, "phone", value);
    return { field, available: !unavailable };
  }
  throw validationError([{ field: "query", message: "handle, email, or phone is required" }]);
};

const copyRequestProfilePhotoToArtist = async ({ db, trx, requestId, artistId }) => {
  const q = trx || db;
  if (!q || !requestId || !artistId) return { linked: false, reason: "invalid_input" };
  const mediaSchema = await assertArtistAccessRequestMediaSchema(q);

  const reqLink = await q("entity_media_links")
    .select("media_asset_id")
    .where({
      entity_type: "artist_access_request",
      entity_id: requestId,
      role: "profile_photo",
    })
    .first();
  if (!reqLink?.media_asset_id) return { linked: false, reason: "no_request_photo" };

  const existing = await q("entity_media_links")
    .select("id")
    .where({
      entity_type: "artist",
      entity_id: artistId,
      role: "profile_photo",
    })
    .first();
  if (existing?.id) return { linked: false, reason: "already_linked" };

  const linkColumns = mediaSchema.entityMediaLinkColumns;
  const insertPayload = {
    media_asset_id: reqLink.media_asset_id,
    entity_type: "artist",
    entity_id: artistId,
    role: "profile_photo",
    sort_order: 0,
  };
  if (Object.prototype.hasOwnProperty.call(linkColumns, "id")) {
    insertPayload.id = randomUUID();
  }
  if (Object.prototype.hasOwnProperty.call(linkColumns, "created_at")) {
    insertPayload.created_at = q.fn.now();
  }

  const rows = await q("entity_media_links").insert(insertPayload).returning(["id"]);
  return { linked: true, id: rows?.[0]?.id };
};

const linkRequestProfilePhotoToArtist = async ({ trx, requestId, artistId }) => {
  await copyRequestProfilePhotoToArtist({ trx, requestId, artistId });
};

module.exports = {
  trim,
  PROFILE_PHOTO_UPLOAD_FIELDS,
  MAX_PROFILE_PHOTO_UPLOAD_BYTES,
  ALLOWED_PROFILE_PHOTO_MIME_TYPES,
  isValidProfilePhotoUpload,
  submitArtistAccessRequest,
  checkArtistAccessAvailability,
  copyRequestProfilePhotoToArtist,
  linkRequestProfilePhotoToArtist,
};
