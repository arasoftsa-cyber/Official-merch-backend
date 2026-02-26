const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");
const { UPLOADS_DIR } = require("../../config/paths");
const { toAbsolutePublicUrl } = require("../../utils/publicUrl");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const HANDLE_RE = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const HTTP_URL_RE = /^https?:\/\//i;
const PROFILE_PHOTO_FIELDS = new Set(["profile_photo", "profilePhoto"]);
const MAX_UPLOAD_BYTES = 1024 * 1024;
const UPLOAD_DIR = path.join(UPLOADS_DIR, "artist-access-requests");

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

const hasTable = async (db, tableName) => db.schema.hasTable(tableName);

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
  if (!(await hasTable(db, "artists"))) return false;
  const artistsInfo = await db("artists").columnInfo();
  if (!Object.prototype.hasOwnProperty.call(artistsInfo, "handle")) return false;
  const hit = await db("artists")
    .whereRaw("lower(trim(handle)) = lower(trim(?))", [handle])
    .first("id");
  return Boolean(hit);
};

const existsInUsersByEmail = async (db, email) => {
  if (!(await hasTable(db, "users"))) return false;
  const usersInfo = await db("users").columnInfo();
  if (!Object.prototype.hasOwnProperty.call(usersInfo, "email")) return false;
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

const saveUploadedFile = async (file) => {
  if (!file || !PROFILE_PHOTO_FIELDS.has(file.fieldname) || !file.buffer?.length) return null;
  if (file.buffer.length > MAX_UPLOAD_BYTES) return null;

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const originalExt = path.extname(file.originalname || "").slice(0, 12);
  const ext = /^[.][a-z0-9]+$/i.test(originalExt) ? originalExt : "";
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const absolutePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(absolutePath, file.buffer);
  return `/uploads/artist-access-requests/${filename}`;
};

const submitArtistAccessRequest = async ({ rawBody = {}, file = null }) => {
  const payload = normalizePayload(rawBody);
  if (process.env.NODE_ENV !== "production" || process.env.DEBUG_ARTIST_ACCESS_REQUESTS === "1") {
    console.log("[artist-access-request] socials type before normalize:", typeof payload.socials);
  }
  const socialsArr = normalizeSocials(payload.socials);
  console.log("[artist-access-request] socials final:", JSON.stringify(socialsArr));

  const details = validatePayload(payload);
  if (details.length > 0) {
    throw validationError(details);
  }
  if (file && !PROFILE_PHOTO_FIELDS.has(file.fieldname)) {
    throw validationError([
      { field: "profile_photo", message: "profile_photo field name is invalid" },
    ]);
  }
  if (file && file.buffer?.length > MAX_UPLOAD_BYTES) {
    throw validationError([
      { field: "profile_photo", message: `profile_photo max size is ${MAX_UPLOAD_BYTES} bytes` },
    ]);
  }

  const db = getDb();
  const preConflictField = await findConflictField(db, payload);
  if (preConflictField) {
    throw conflictError(preConflictField);
  }

  const requestId = randomUUID();
  try {
    const [createdRow] = await db.transaction(async (trx) => {
      const tableInfo = await trx("artist_access_requests").columnInfo();
      const insertPayload = {
        id: requestId,
        artist_name: payload.artist_name,
        handle: payload.handle,
        email: payload.email,
        phone: payload.phone,
        socials: trx.raw("?::jsonb", [JSON.stringify(socialsArr)]),
      };

      if (Object.prototype.hasOwnProperty.call(tableInfo, "about_me")) {
        insertPayload.about_me = payload.about || null;
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "message_for_fans")) {
        insertPayload.message_for_fans = payload.message_for_fans || null;
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "about")) {
        insertPayload.about = payload.about || null;
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "contact_email")) {
        insertPayload.contact_email = payload.email;
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "contact_phone")) {
        insertPayload.contact_phone = payload.phone;
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "pitch")) {
        insertPayload.pitch = payload.about || null;
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "status")) {
        insertPayload.status = "pending";
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "created_at")) {
        insertPayload.created_at = trx.fn.now();
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "updated_at")) {
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
          await trx("media_assets").insert({
            id: mediaAssetId,
            public_url: publicUrl,
            created_at: trx.fn.now(),
          });
          await trx("entity_media_links").insert({
            id: randomUUID(),
            media_asset_id: mediaAssetId,
            entity_type: "artist_access_request",
            entity_id: requestId,
            role: "profile_photo",
            sort_order: 0,
            created_at: trx.fn.now(),
          });

          const requestUpdates = {};
          if (Object.prototype.hasOwnProperty.call(tableInfo, "profile_photo_path")) {
            requestUpdates.profile_photo_path = publicUrl;
          }
          if (Object.prototype.hasOwnProperty.call(tableInfo, "profile_photo_url")) {
            requestUpdates.profile_photo_url = publicUrl;
          }
          if (Object.keys(requestUpdates).length > 0) {
            await trx("artist_access_requests").where({ id: requestId }).update(requestUpdates);
          }
        }
      }

      return [inserted];
    });

    return {
      request_id: requestId,
      created_at: createdRow?.created_at || new Date().toISOString(),
    };
  } catch (error) {
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

  const linkColumns = await q("entity_media_links").columnInfo();
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
  submitArtistAccessRequest,
  checkArtistAccessAvailability,
  copyRequestProfilePhotoToArtist,
  linkRequestProfilePhotoToArtist,
};
