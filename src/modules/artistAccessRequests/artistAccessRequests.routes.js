const express = require("express");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");

const router = express.Router();
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "artist-access-requests");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const safeJson = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const parseContentDisposition = (line) => {
  const nameMatch = line.match(/name="([^"]+)"/i);
  const filenameMatch = line.match(/filename="([^"]*)"/i);
  return {
    name: nameMatch?.[1] || "",
    filename: filenameMatch?.[1] || "",
  };
};

const splitBufferBy = (buffer, delimiter) => {
  const chunks = [];
  let start = 0;
  while (start <= buffer.length) {
    const idx = buffer.indexOf(delimiter, start);
    if (idx === -1) {
      chunks.push(buffer.subarray(start));
      break;
    }
    chunks.push(buffer.subarray(start, idx));
    start = idx + delimiter.length;
  }
  return chunks;
};

const parseMultipartFormData = async (req) => {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return null;
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    return { fields: {}, file: null, parseError: "missing_boundary" };
  }

  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

  const delimiter = Buffer.from(`--${boundary}`);
  const rawParts = splitBufferBy(body, delimiter);
  const fields = {};
  let file = null;

  for (const rawPart of rawParts) {
    if (!rawPart || rawPart.length === 0) continue;
    let part = rawPart;
    if (part.subarray(0, 2).toString() === "\r\n") {
      part = part.subarray(2);
    }
    if (part.length === 0) continue;
    if (part.subarray(0, 2).toString() === "--") continue;

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) continue;
    const headerText = part.subarray(0, headerEnd).toString("utf8");
    let content = part.subarray(headerEnd + 4);
    if (content.subarray(content.length - 2).toString() === "\r\n") {
      content = content.subarray(0, content.length - 2);
    }

    const dispositionLine = headerText
      .split("\r\n")
      .find((line) => /^content-disposition:/i.test(line));
    if (!dispositionLine) continue;
    const { name, filename } = parseContentDisposition(dispositionLine);
    if (!name) continue;

    const contentTypeLine = headerText
      .split("\r\n")
      .find((line) => /^content-type:/i.test(line));
    const mimeType = contentTypeLine
      ? contentTypeLine.split(":")[1]?.trim() || "application/octet-stream"
      : "application/octet-stream";

    if (filename) {
      file = {
        fieldname: name,
        originalname: filename,
        mimetype: mimeType,
        buffer: content,
      };
      continue;
    }

    fields[name] = content.toString("utf8");
  }

  return { fields, file };
};

const normalizeSocials = (value) => {
  if (value == null || value === "") return [];
  const parsed =
    typeof value === "string" ? safeJson(value, null) : Array.isArray(value) ? value : null;
  if (!Array.isArray(parsed)) return null;
  return parsed.map((entry) => ({
    platform: trim(entry?.platform),
    profileLink: trim(entry?.profileLink),
  }));
};

const normalizePayload = (body) => {
  const artistName = trim(body?.artistName || body?.artist_name);
  const handle = trim(body?.handle);
  const email = trim(body?.email || body?.contactEmail || body?.contact_email);
  const phone = trim(body?.phone || body?.contactPhone || body?.contact_phone);
  const aboutMe = trim(body?.aboutMe || body?.about_me || body?.pitch);
  const messageForFans = trim(body?.messageForFans || body?.message_for_fans || body?.fan_message);
  const socials = normalizeSocials(body?.socials);
  const profilePhotoMediaAssetId = trim(body?.profilePhotoMediaAssetId || body?.profile_photo_media_asset_id);
  return {
    artistName,
    handle,
    email,
    phone,
    aboutMe,
    messageForFans,
    socials,
    profilePhotoMediaAssetId,
  };
};

const validatePayload = (payload) => {
  if (!payload.artistName) return { field: "artistName" };
  if (!payload.handle) return { field: "handle" };
  if (!payload.email) return { field: "email" };
  if (!payload.phone) return { field: "phone" };
  if (!EMAIL_RE.test(payload.email)) return { field: "email" };
  if (!Array.isArray(payload.socials)) return { field: "socials" };
  if (payload.profilePhotoMediaAssetId && !UUID_RE.test(payload.profilePhotoMediaAssetId)) {
    return { field: "profilePhotoMediaAssetId" };
  }

  for (const row of payload.socials) {
    if (!trim(row?.platform) || !trim(row?.profileLink)) {
      return { field: "socials" };
    }
  }
  return null;
};

const saveUploadedFile = async (file) => {
  if (!file || file.fieldname !== "profilePhoto" || !file.buffer?.length) return null;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const originalExt = path.extname(file.originalname || "").slice(0, 12);
  const ext = /^[.][a-z0-9]+$/i.test(originalExt) ? originalExt : "";
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const absolutePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(absolutePath, file.buffer);
  return `/uploads/artist-access-requests/${filename}`;
};

const duplicateResponse = (res, field) =>
  res.status(409).json({ error: "already_exists", field });

const artistColumnInfo = async (db) => {
  const hasArtistsTable = await db.schema.hasTable("artists");
  if (!hasArtistsTable) return null;
  return db("artists").columnInfo();
};

const hasExistingRequestByField = async (db, field, value) => {
  if (field === "phone") {
    const hit = await db("artist_access_requests")
      .whereRaw("lower(trim(phone)) = lower(trim(?))", [value])
      .first("id");
    return Boolean(hit);
  }
  const hit = await db("artist_access_requests")
    .whereRaw(`lower(${field}) = lower(?)`, [value])
    .first("id");
  return Boolean(hit);
};

const hasExistingArtistByField = async (db, artistsInfo, field, value) => {
  if (!artistsInfo) return false;
  if (!Object.prototype.hasOwnProperty.call(artistsInfo, field)) return false;
  if (field === "phone") {
    const hit = await db("artists")
      .whereRaw("lower(trim(phone)) = lower(trim(?))", [value])
      .first("id");
    return Boolean(hit);
  }
  const hit = await db("artists")
    .whereRaw(`lower(${field}) = lower(?)`, [value])
    .first("id");
  return Boolean(hit);
};

const isFieldAvailable = async (db, artistsInfo, field, value) => {
  const normalized = trim(value);
  if (!normalized) return false;
  const inRequests = await hasExistingRequestByField(db, field, normalized);
  if (inRequests) return false;
  const inArtists = await hasExistingArtistByField(db, artistsInfo, field, normalized);
  return !inArtists;
};

const mapUniqueViolationToField = (error) => {
  const detail = `${error?.detail || ""} ${error?.constraint || ""}`.toLowerCase();
  if (detail.includes("handle")) return "handle";
  if (detail.includes("email")) return "email";
  if (detail.includes("phone")) return "phone";
  return null;
};

router.get("/check", async (req, res) => {
  const handle = trim(req.query?.handle);
  const email = trim(req.query?.email);
  const phone = trim(req.query?.phone);
  let field = "";
  let value = "";
  if (handle) {
    field = "handle";
    value = handle;
  } else if (email) {
    field = "email";
    value = email;
  } else if (phone) {
    field = "phone";
    value = phone;
  } else {
    return res.status(400).json({ error: "validation_error", message: "handle, email, or phone is required" });
  }

  try {
    const db = getDb();
    const artistsInfo = await artistColumnInfo(db);
    const available = await isFieldAvailable(db, artistsInfo, field, value);
    return res.status(200).json({ field, available });
  } catch (err) {
    return res.status(500).json({ error: "internal_server_error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const multipart = await parseMultipartFormData(req);
    if (multipart?.parseError) {
      return res.status(400).json({ error: "validation_error", message: "invalid multipart payload" });
    }
    const body = multipart?.fields || req.body || {};
    const payload = normalizePayload(body);
    const validationError = validatePayload(payload);
    if (validationError) {
      return res
        .status(400)
        .json({ error: "validation_error", field: validationError.field });
    }

    const db = getDb();
    const artistsInfo = await artistColumnInfo(db);

    for (const field of ["handle", "email", "phone"]) {
      const available = await isFieldAvailable(db, artistsInfo, field, payload[field]);
      if (!available) {
        return duplicateResponse(res, field);
      }
    }

    const requestId = randomUUID();
    await db.transaction(async (trx) => {
      const tableInfo = await trx("artist_access_requests").columnInfo();
      const insertPayload = {
        id: requestId,
        artist_name: payload.artistName,
        handle: payload.handle,
        email: payload.email,
        phone: payload.phone,
        socials: payload.socials,
        about_me: payload.aboutMe || null,
        message_for_fans: payload.messageForFans || null,
        status: "pending",
        created_at: trx.fn.now(),
      };
      if (Object.prototype.hasOwnProperty.call(tableInfo, "updated_at")) {
        insertPayload.updated_at = trx.fn.now();
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "contact_email")) {
        insertPayload.contact_email = payload.email;
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "contact_phone")) {
        insertPayload.contact_phone = payload.phone;
      }
      if (Object.prototype.hasOwnProperty.call(tableInfo, "pitch")) {
        insertPayload.pitch = payload.aboutMe || null;
      }

      // Insert request first (without media linkage).
      await trx("artist_access_requests").insert(insertPayload);

      if (payload.profilePhotoMediaAssetId) {
        const existingManualLink = await trx("entity_media_links")
          .where({
            entity_type: "artist_access_request",
            entity_id: requestId,
            role: "profile_photo",
            media_asset_id: payload.profilePhotoMediaAssetId,
          })
          .first("id");
        if (!existingManualLink) {
          await trx("entity_media_links").insert({
            id: randomUUID(),
            media_asset_id: payload.profilePhotoMediaAssetId,
            entity_type: "artist_access_request",
            entity_id: requestId,
            role: "profile_photo",
            sort_order: 0,
            created_at: trx.fn.now(),
          });
        }
      }

      if (multipart?.file && multipart.file.fieldname === "profilePhoto") {
        const publicUrl = await saveUploadedFile(multipart.file);
        if (publicUrl) {
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

          // Keep backward compatibility with existing consumers reading request columns.
          const requestUpdates = {};
          if (Object.prototype.hasOwnProperty.call(tableInfo, "profile_photo_path")) {
            requestUpdates.profile_photo_path = publicUrl;
          }
          if (Object.prototype.hasOwnProperty.call(tableInfo, "profile_photo_url")) {
            requestUpdates.profile_photo_url = publicUrl;
          }
          if (Object.keys(requestUpdates).length > 0) {
            await trx("artist_access_requests")
              .where({ id: requestId })
              .update(requestUpdates);
          }
        }
      }
    });

    return res.status(201).json({ id: requestId });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "already_exists" });
    }
    console.error(err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

module.exports = router;
