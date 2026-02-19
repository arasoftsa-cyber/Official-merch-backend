const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");

const router = express.Router();

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeSocials = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { url: value };
    }
  }
  return null;
};

const parseRequestPayload = (body) => {
  const artistName = trim(body?.artist_name || body?.artistName);
  if (!artistName) {
    return { error: "validation_error", message: "Artist name is required" };
  }
  const handle =
    trim(body?.handle || body?.handle_suggestion || body?.handleSuggestion) || null;
  const contactEmail = trim(body?.email || body?.contactEmail) || null;
  if (!contactEmail) {
    return { error: "validation_error", message: "Email is required" };
  }
  const contactPhone = trim(body?.phone || body?.contactPhone) || null;
  const socials = normalizeSocials(body?.socials);
  const pitch = trim(body?.pitch) || null;
  return {
    artist_name: artistName,
    handle,
    contact_email: contactEmail,
    contact_phone: contactPhone,
    socials,
    pitch,
  };
};

router.post("/", express.json(), async (req, res, next) => {
  try {
    const requestorUserId =
      req.user?.id ?? req.auth?.userId ?? req.ctx?.userId ?? req.context?.userId ?? null;
    const payload = parseRequestPayload(req.body);
    if (payload.error) {
      return res.status(400).json(payload);
    }
    const db = getDb();
    const columnInfo = await db("artist_access_requests").columnInfo();
    const insertPayload = {
      id: randomUUID(),
      artist_name: payload.artist_name,
      handle: payload.handle,
      contact_email: payload.contact_email,
      contact_phone: payload.contact_phone,
      socials: payload.socials,
      pitch: payload.pitch,
      status: "pending",
      created_at: db.fn.now(),
    };
    if (
      requestorUserId &&
      Object.prototype.hasOwnProperty.call(columnInfo, "requestor_user_id")
    ) {
      insertPayload.requestor_user_id = requestorUserId;
    } else if (requestorUserId && Object.prototype.hasOwnProperty.call(columnInfo, "user_id")) {
      insertPayload.user_id = requestorUserId;
    } else if (
      requestorUserId &&
      Object.prototype.hasOwnProperty.call(columnInfo, "answers_json")
    ) {
      insertPayload.answers_json = { requesterUserId: requestorUserId };
    }
    if (Object.prototype.hasOwnProperty.call(columnInfo, "email")) {
      insertPayload.email = payload.contact_email;
    }
    let row;
    [row] = await db("artist_access_requests")
      .insert(insertPayload)
      .returning(["id", "status"]);
    const inserted = Array.isArray(row) ? row[0] : row;
    return res.status(201).json({
      ok: true,
      id: inserted.id,
      requestId: inserted.id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
