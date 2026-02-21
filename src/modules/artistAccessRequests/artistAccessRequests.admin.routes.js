const express = require("express");
const { randomUUID, randomBytes } = require("crypto");
const { getDb } = require("../../config/db");
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");
const { hashPassword } = require("../../utils/password");
const { signToken } = require("../../utils/jwt");

const ROUTER = express.Router();
const STATUS_OPTIONS = new Set(["pending", "approved", "rejected"]);
const LIST_STATUS_OPTIONS = new Set(["pending", "approved", "rejected", "denied"]);

const isUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value
  );

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeForResponse = (status) =>
  status === "denied" ? "rejected" : status || "pending";

const normalizeStatusFilter = (value) => {
  if (!value) return "pending";
  const normalized = String(value).trim().toLowerCase();
  if (!LIST_STATUS_OPTIONS.has(normalized)) return null;
  return normalized;
};

const mapRow = (row) => ({
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  status: normalizeForResponse(row.status),
  source: row.source || "artist_access_request",
  labelId: row.label_id || null,
  artistName: row.artist_name || row.name || "",
  handle: row.handle || row.handle_suggestion || "",
  email: row.email || row.contact_email || "",
  phone: row.phone || row.contact_phone || "",
  socials: row.socials || [],
  aboutMe: row.about_me || row.pitch || "",
  profilePhotoUrl:
    row.profile_photo_media_url || row.profile_photo_url || row.profile_photo_path || "",
  messageForFans: row.message_for_fans || "",
  rejectionComment: row.rejection_comment || "",
});

const pickExistingColumns = (columnInfo, candidates) =>
  candidates.filter((column) =>
    Object.prototype.hasOwnProperty.call(columnInfo, column)
  );

const slugifyHandle = (value) => {
  const base =
    (value || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "artist";
  return base;
};

const ensureUniqueHandle = async (trx, base) => {
  let suffix = 0;
  let candidate = base;
  while (
    await trx("artists")
      .whereRaw("lower(handle) = lower(?)", [candidate])
      .first("id")
  ) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
};

const findUserByEmail = async (trx, email) => {
  return trx("users")
    .whereRaw("lower(trim(email)) = lower(trim(?))", [email])
    .first("id", "email", "role");
};

const resolveOrCreateArtistUser = async (trx, email) => {
  const normalizedEmail = trim(email).toLowerCase();
  if (!normalizedEmail) {
    throw {
      status: 400,
      error: "validation_error",
      message: "email is required for approval",
    };
  }

  const existing = await findUserByEmail(trx, normalizedEmail);
  if (existing?.id) {
    await trx("users").where({ id: existing.id }).update({ role: "artist" });
    return { id: existing.id, email: existing.email || normalizedEmail, created: false };
  }

  const tempPassword = randomBytes(18).toString("hex");
  const passwordHash = await hashPassword(tempPassword);
  const id = randomUUID();
  await trx("users").insert({
    id,
    email: normalizedEmail,
    password_hash: passwordHash,
    role: "artist",
    created_at: trx.fn.now(),
  });
  return { id, email: normalizedEmail, created: true };
};

const createArtistFromRequest = async (trx, request, userId) => {
  const requestedName = trim(request.artist_name || request.name) || "Unknown Artist";
  const requestedHandle = trim(request.handle || request.handle_suggestion);
  const handleBase = slugifyHandle(requestedHandle || requestedName);
  const handle = await ensureUniqueHandle(trx, handleBase);

  const artistColumns = await trx("artists").columnInfo();
  const insertPayload = {
    id: randomUUID(),
    handle,
    name: requestedName,
    created_at: trx.fn.now(),
  };

  // Preserve profile metadata if schema supports it.
  if (Object.prototype.hasOwnProperty.call(artistColumns, "email")) {
    insertPayload.email = trim(request.email || request.contact_email) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "phone")) {
    insertPayload.phone = trim(request.phone || request.contact_phone) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "about_me")) {
    insertPayload.about_me = trim(request.about_me || request.pitch) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "profile_photo_url")) {
    insertPayload.profile_photo_url =
      trim(request.profile_photo_url || request.profile_photo_path) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "message_for_fans")) {
    insertPayload.message_for_fans = trim(request.message_for_fans) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "socials")) {
    insertPayload.socials = request.socials ?? [];
  }

  const [artistRow] = await trx("artists")
    .insert(insertPayload)
    .returning(["id", "handle", "name"]);

  // Always overwrite from request for onboarding profile fields where columns exist.
  const artistUpdates = {};
  if (Object.prototype.hasOwnProperty.call(artistColumns, "phone")) {
    artistUpdates.phone = trim(request.phone || request.contact_phone) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "about_me")) {
    artistUpdates.about_me = trim(request.about_me || request.pitch) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "message_for_fans")) {
    artistUpdates.message_for_fans = trim(request.message_for_fans) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "socials")) {
    artistUpdates.socials = request.socials ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "email")) {
    artistUpdates.email = trim(request.email || request.contact_email) || null;
  }
  if (Object.prototype.hasOwnProperty.call(artistColumns, "updated_at")) {
    artistUpdates.updated_at = trx.fn.now();
  }
  if (Object.keys(artistUpdates).length > 0) {
    await trx("artists").where({ id: artistRow.id }).update(artistUpdates);
  }

  await trx("artist_user_map")
    .insert({
      id: randomUUID(),
      artist_id: artistRow.id,
      user_id: userId,
    })
    .onConflict(["artist_id", "user_id"])
    .ignore();

  const labelIdCandidate = request.label_id || request.labelId || null;
  if (labelIdCandidate) {
    await trx("label_artist_map")
      .insert({
        id: randomUUID(),
        label_id: labelIdCandidate,
        artist_id: artistRow.id,
      })
      .onConflict(["label_id", "artist_id"])
      .ignore();
  }

  return artistRow;
};

const carryOverProfilePhotoLink = async (trx, requestId, artistId) => {
  const hasEntityMediaLinks = await trx.schema.hasTable("entity_media_links");
  const hasMediaAssets = await trx.schema.hasTable("media_assets");
  if (!hasEntityMediaLinks || !hasMediaAssets) return;

  const linkColumns = await trx("entity_media_links").columnInfo();
  const sourceLink = await trx("entity_media_links")
    .where({
      entity_type: "artist_access_request",
      entity_id: requestId,
      role: "profile_photo",
    })
    .orderBy("sort_order", "asc")
    .first("media_asset_id");
  if (!sourceLink?.media_asset_id) return;

  const existingArtistPhoto = await trx("entity_media_links")
    .where({
      entity_type: "artist",
      entity_id: artistId,
      role: "profile_photo",
    })
    .first("id");
  if (existingArtistPhoto?.id) return;

  const insertPayload = {
    id: randomUUID(),
    media_asset_id: sourceLink.media_asset_id,
    entity_type: "artist",
    entity_id: artistId,
    role: "profile_photo",
    sort_order: 0,
  };
  if (Object.prototype.hasOwnProperty.call(linkColumns, "created_at")) {
    insertPayload.created_at = trx.fn.now();
  }
  await trx("entity_media_links").insert(insertPayload);
};

const buildResetLink = (user) => {
  const base =
    process.env.FRONTEND_URL || process.env.CLIENT_URL || "http://localhost:5173";
  const token = signToken(
    {
      sub: user.id,
      email: user.email,
      purpose: "password_reset",
    },
    { expiresIn: "24h" }
  );
  return `${String(base).replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
};

const sendEmailOrLog = async ({ to, subject, text }) => {
  // No email provider wired yet in this repository. Log in development as fallback.
  if (process.env.NODE_ENV !== "production") {
    console.log("[artist-request-email:dev-stub]", { to, subject, text });
    return;
  }

  // Production fallback: keep non-blocking and observable.
  console.warn("[artist-request-email:missing-provider]", { to, subject });
};

const sendApprovalEmail = async ({ email, artistName, resetLink }) => {
  await sendEmailOrLog({
    to: email,
    subject: "Your artist onboarding request was approved",
    text: `Hi ${artistName || "Artist"}, your request was approved. Set your password here: ${resetLink}`,
  });
};

const sendRejectionEmail = async ({ email, artistName, comment }) => {
  await sendEmailOrLog({
    to: email,
    subject: "Your artist onboarding request was rejected",
    text: `Hi ${artistName || "Artist"}, your request was rejected. Comment: ${comment}`,
  });
};

const processApproval = async ({ id, adminId }) => {
  return getDb().transaction(async (trx) => {
    const request = await trx("artist_access_requests").where({ id }).first();
    if (!request) return { notFound: true };

    const currentStatus = normalizeForResponse(request.status);
    if (currentStatus !== "pending") return { invalidTransition: true, currentStatus };

    const requestEmail = trim(request.email || request.contact_email).toLowerCase();
    if (!requestEmail) {
      return {
        validationError: true,
        message: "Request is missing email",
      };
    }

    const user = await resolveOrCreateArtistUser(trx, requestEmail);
    const artist = await createArtistFromRequest(trx, request, user.id);
    await carryOverProfilePhotoLink(trx, id, artist.id);

    const requestColumns = await trx("artist_access_requests").columnInfo();
    const updates = {
      status: "approved",
    };
    if (Object.prototype.hasOwnProperty.call(requestColumns, "decided_at")) {
      updates.decided_at = trx.fn.now();
    }
    if (Object.prototype.hasOwnProperty.call(requestColumns, "decided_by_user_id")) {
      updates.decided_by_user_id = adminId || null;
    }
    if (Object.prototype.hasOwnProperty.call(requestColumns, "updated_at")) {
      updates.updated_at = trx.fn.now();
    }

    if (Object.prototype.hasOwnProperty.call(requestColumns, "requestor_user_id")) {
      updates.requestor_user_id = user.id;
    }
    if (Object.prototype.hasOwnProperty.call(requestColumns, "rejection_comment")) {
      updates.rejection_comment = null;
    }

    await trx("artist_access_requests").where({ id }).update(updates);

    return {
      status: "approved",
      email: requestEmail,
      artistName: trim(request.artist_name || request.name),
      user,
      artist,
    };
  });
};

const processRejection = async ({ id, adminId, comment }) => {
  return getDb().transaction(async (trx) => {
    const request = await trx("artist_access_requests").where({ id }).first();
    if (!request) return { notFound: true };

    const currentStatus = normalizeForResponse(request.status);
    if (currentStatus !== "pending") return { invalidTransition: true, currentStatus };

    const requestColumns = await trx("artist_access_requests").columnInfo();
    const updates = {
      status: "rejected",
    };
    if (Object.prototype.hasOwnProperty.call(requestColumns, "decided_at")) {
      updates.decided_at = trx.fn.now();
    }
    if (Object.prototype.hasOwnProperty.call(requestColumns, "decided_by_user_id")) {
      updates.decided_by_user_id = adminId || null;
    }
    if (Object.prototype.hasOwnProperty.call(requestColumns, "updated_at")) {
      updates.updated_at = trx.fn.now();
    }

    if (Object.prototype.hasOwnProperty.call(requestColumns, "rejection_comment")) {
      updates.rejection_comment = comment;
    }

    await trx("artist_access_requests").where({ id }).update(updates);

    return {
      status: "rejected",
      email: trim(request.email || request.contact_email).toLowerCase(),
      artistName: trim(request.artist_name || request.name),
      comment,
    };
  });
};

ROUTER.get(
  "/",
  requireAuth,
  requirePolicy("admin_dashboard:read", "artist_access_requests"),
  async (req, res) => {
    try {
      const status = normalizeStatusFilter(req.query.status);
      if (!status) {
        return res
          .status(400)
          .json({ error: "validation_error", message: "Invalid status filter" });
      }

      const page = Math.max(
        1,
        Number.parseInt(req.query.page?.toString() || "1", 10) || 1
      );
      const pageSize = Math.min(
        100,
        Math.max(
          1,
          Number.parseInt(req.query.pageSize?.toString() || "20", 10) || 20
        )
      );

      const db = getDb();
      const requestColumnInfo = await db("artist_access_requests").columnInfo();
      const hasEntityMediaLinks = await db.schema.hasTable("entity_media_links");
      const hasMediaAssets = await db.schema.hasTable("media_assets");
      const offset = (page - 1) * pageSize;
      const [{ total = 0 } = {}] = await db("artist_access_requests")
        .where("status", status)
        .count({ total: "id" });

      const selectColumns = pickExistingColumns(requestColumnInfo, [
        "id",
        "artist_name",
        "name",
        "handle",
        "handle_suggestion",
        "email",
        "contact_email",
        "phone",
        "contact_phone",
        "socials",
        "about_me",
        "pitch",
        "profile_photo_url",
        "profile_photo_path",
        "message_for_fans",
        "status",
        "source",
        "label_id",
        "rejection_comment",
        "created_at",
        "updated_at",
      ]);

      const baseSelections = selectColumns.map(
        (column) => `artist_access_requests.${column} as ${column}`
      );
      const rowsQuery = db("artist_access_requests")
        .where("artist_access_requests.status", status)
        .orderBy("artist_access_requests.created_at", "desc")
        .orderBy("artist_access_requests.id", "desc")
        .limit(pageSize)
        .offset(offset)
        .select(baseSelections);

      if (hasEntityMediaLinks && hasMediaAssets) {
        rowsQuery
          .leftJoin("entity_media_links", function () {
            this.on("entity_media_links.entity_id", "=", "artist_access_requests.id")
              .andOnVal("entity_media_links.entity_type", "=", "artist_access_request")
              .andOnVal("entity_media_links.role", "=", "profile_photo");
          })
          .leftJoin("media_assets", "media_assets.id", "entity_media_links.media_asset_id")
          .select("media_assets.public_url as profile_photo_media_url");
      }

      const rows = await rowsQuery;

      const items = rows.map(mapRow);
      return res.json({ items, total: Number(total), page, pageSize });
    } catch (err) {
      console.error("artist-access-requests admin list error", err);
      return res.status(500).json({ error: "internal_server_error" });
    }
  }
);

ROUTER.get(
  "/pending-count",
  requireAuth,
  requirePolicy("admin_dashboard:read", "artist_access_requests"),
  async (req, res) => {
    try {
      const db = getDb();
      const [{ count = 0 } = {}] = await db("artist_access_requests")
        .where({ status: "pending" })
        .count({ count: "id" });
      return res.json({ count: Number(count) });
    } catch (err) {
      console.error("pending-count failed", err);
      return res.status(500).json({ error: "internal_server_error" });
    }
  }
);

const policy = requirePolicy("admin_dashboard:write", "artist_access_requests");

ROUTER.post("/:id/approve", requireAuth, policy, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Invalid id" });
    }

    const result = await processApproval({ id: req.params.id, adminId: req.user?.id || null });
    if (result.notFound) {
      return res.status(404).json({ error: "not_found", message: "Request not found" });
    }
    if (result.validationError) {
      return res.status(400).json({ error: "validation_error", message: result.message });
    }
    if (result.invalidTransition) {
      return res.status(409).json({
        error: "invalid_transition",
        message: `Cannot transition from ${result.currentStatus} to approved`,
      });
    }

    const resetLink = buildResetLink(result.user);
    await sendApprovalEmail({
      email: result.email,
      artistName: result.artistName,
      resetLink,
    });

    return res.status(200).json({
      ok: true,
      status: "approved",
      requestId: req.params.id,
      artistId: result.artist?.id ?? null,
      userId: result.user?.id ?? null,
    });
  } catch (err) {
    console.error("[approve_artist_request]", err?.stack || err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

ROUTER.post("/:id/reject", requireAuth, policy, express.json(), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Invalid id" });
    }

    const comment = trim(req.body?.comment);
    if (!comment) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Rejection comment is required" });
    }

    const result = await processRejection({
      id: req.params.id,
      adminId: req.user?.id || null,
      comment,
    });

    if (result.notFound) {
      return res.status(404).json({ error: "not_found", message: "Request not found" });
    }
    if (result.invalidTransition) {
      return res.status(409).json({
        error: "invalid_transition",
        message: `Cannot transition from ${result.currentStatus} to rejected`,
      });
    }

    if (result.email) {
      await sendRejectionEmail({
        email: result.email,
        artistName: result.artistName,
        comment,
      });
    }

    return res.status(200).json({ status: "rejected" });
  } catch (err) {
    console.error("[reject_artist_request]", err?.stack || err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

module.exports = ROUTER;
