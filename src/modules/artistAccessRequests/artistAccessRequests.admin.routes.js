const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");
const { requireAuth } = require("../../middleware/auth.middleware");
const { requirePolicy } = require("../../middleware/policy.middleware");

const STATUS_VALUES = new Set(["pending", "approved", "rejected", "denied"]);
const TRANSITIONS = {
  pending: new Set(["approved", "rejected"]),
  approved: new Set(["approved"]),
  rejected: new Set(["rejected"]),
  denied: new Set(["denied", "rejected"]),
};
const ROUTER = express.Router();

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const normalizeStatus = (value) => {
  if (!value) return null;
  const candidate = value.toLowerCase();
  return STATUS_VALUES.has(candidate) ? candidate : null;
};

const normalizeForResponse = (status) =>
  status === "denied" ? "rejected" : status || "pending";

const mapRow = (row) => ({
  id: row.id,
  createdAt: row.created_at,
  status: normalizeForResponse(row.status),
  source: row.source,
  labelId: row.label_id || null,
  name: row.name,
  handle: row.handle || null,
  handleSuggestion: row.handle_suggestion || null,
  contactEmail: row.contact_email || null,
  contactPhone: row.contact_phone || null,
  socials: row.socials || null,
  pitch: row.pitch || null,
});

const slugifyHandle = (value) => {
  const base =
    (value || '')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '') || 'artist';
  return base;
};

const ensureUniqueHandle = async (trx, base) => {
  let suffix = 0;
  let candidate = base;
  while (await trx('artists').where({ handle: candidate }).first()) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
};

const resolveRequesterUserId = async (trx, request) => {
  const answers = request.answers_json ?? {};
  const requestorUserId = request.requestor_user_id ?? null;
  if (requestorUserId) {
    if (!isUuid(requestorUserId)) {
      throw { status: 400, error: "bad_request", message: "requester_user_id_invalid" };
    }
    const user = await trx("users").where({ id: requestorUserId }).first("id");
    if (!user?.id) {
      throw { status: 400, error: "bad_request", message: "requester_user_not_found" };
    }
    return user.id;
  }

  const emailCandidates = [
    request.contact_email,
    request.contactEmail,
    request.email,
    answers.contact_email,
    answers.contactEmail,
    answers.email,
    answers.requester_email,
    answers.requesterEmail,
  ];
  const dynamicEmail = Object.entries(request || {}).find(
    ([key, value]) => /email/i.test(String(key)) && typeof value === "string" && value.trim()
  )?.[1];
  if (dynamicEmail) {
    emailCandidates.push(dynamicEmail);
  }
  const email = String(
    emailCandidates.find((value) => typeof value === "string" && value.trim()) || ""
  )
    .trim()
    .toLowerCase();
  if (!email) {
    throw { status: 400, error: "bad_request", message: "request_missing_requester_user_id" };
  }
  const userByEmail = await trx("users").whereRaw("lower(email)=?", email).first("id");
  if (!userByEmail?.id) {
    throw { status: 400, error: "bad_request", message: "requester_user_not_found" };
  }
  return userByEmail.id;
};

const ensureArtistUserMapLink = async (trx, artistId, userId) => {
  await trx('artist_user_map')
    .insert({
      id: randomUUID(),
      artist_id: artistId,
      user_id: userId,
    })
    .onConflict(['artist_id', 'user_id'])
    .ignore();
  const linked = await trx('artist_user_map')
    .select('id')
    .where({ artist_id: artistId, user_id: userId })
    .first();
  if (!linked) {
    throw new Error('artist_user_map_insert_failed');
  }
  return userId;
};

const formatRequestResponse = (row) => ({
  id: row.id,
  status: normalizeForResponse(row.status),
  decidedAt: row.decided_at ? row.decided_at.toISOString?.() ?? row.decided_at : null,
  decidedByUserId: row.decided_by_user_id || null,
});

const ensureLabelArtistLink = async (trx, labelId, artistId) => {
  if (!labelId) return;
  await trx('label_artist_map')
    .insert({
      id: randomUUID(),
      label_id: labelId,
      artist_id: artistId,
    })
    .onConflict(['label_id', 'artist_id'])
    .ignore();
};

const createArtistFromRequest = async (trx, request, requesterUserId) => {
  const name = request.artist_name || request.name || 'Unknown Artist';
  const requestedHandle = request.handle_suggestion || request.handle || null;
  const handleBase = slugifyHandle(requestedHandle || name);
  let artistRow = await trx("artists").where({ handle: handleBase }).first(["id", "handle", "name"]);
  if (!artistRow) {
    const handle = await ensureUniqueHandle(trx, handleBase);
    const [createdArtist] = await trx('artists')
      .insert({
        id: randomUUID(),
        handle,
        name,
        created_at: trx.fn.now(),
      })
      .returning(['id', 'handle', 'name']);
    artistRow = createdArtist;
  }
  await ensureArtistUserMapLink(trx, artistRow.id, requesterUserId);
  const labelIdCandidate = request.label_id ?? request.labelId ?? null;
  if (labelIdCandidate) {
    await ensureLabelArtistLink(trx, labelIdCandidate, artistRow.id);
  }
  await trx('users')
    .where({ id: requesterUserId })
    .update({ role: 'artist' });
  return { artist: artistRow, userId: requesterUserId };
};

ROUTER.get(
  "/",
  requireAuth,
  requirePolicy("admin_dashboard:read", "artist_access_requests"),
  async (req, res) => {
    try {
      const status = normalizeStatus(req.query.status) ?? 'pending';
      if (req.query.status && !status) {
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
      const offset = (page - 1) * pageSize;
      const db = getDb();
      const countQuery = db("artist_access_requests")
        .where("status", status)
        .count({ total: "id" });
      const [{ total = 0 }] = await countQuery;
      const rows = await db("artist_access_requests")
        .where("status", status)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(pageSize)
        .offset(offset)
        .select(
          "id",
          "artist_name",
          "handle",
          "contact_email",
          "contact_phone",
          "socials",
          "pitch",
          "status",
          "created_at",
          "decided_at",
          "decided_by_user_id"
        );
      const requests = rows.map(mapRow);
      return res.json({
        items: requests,
        requests,
        total: Number(total),
        page,
        pageSize,
      });
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

const isUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value
  );

const updateDecision = async ({ id, targetStatus, adminId }) => {
  if (!STATUS_VALUES.has(targetStatus)) {
    throw new Error("invalid_status");
  }
  return getDb().transaction(async (trx) => {
    const row = await trx("artist_access_requests")
      .where({ id })
      .select("status", "answers_json")
      .first();
    if (!row) return { notFound: true };
    const currentRaw = row.status || "pending";
    const currentStatus = currentRaw === "denied" ? "rejected" : currentRaw;
    if (currentStatus === targetStatus) {
      return { noChange: true, currentStatus };
    }
    if (!TRANSITIONS[currentStatus]?.has(targetStatus)) {
      return { invalidTransition: true, currentStatus };
    }
    const answers = row.answers_json ?? {};
    const decision = {
      status: targetStatus,
      decidedAt: new Date().toISOString(),
      decidedByUserId: adminId || null,
    };
    const updates = {
      status: targetStatus,
      answers_json: { ...answers, decision },
    };
    const columnInfo = await trx("artist_access_requests").columnInfo();
    if (Object.prototype.hasOwnProperty.call(columnInfo, "decided_at")) {
      updates.decided_at = decision.decidedAt;
    }
    if (Object.prototype.hasOwnProperty.call(columnInfo, "decided_by_user_id")) {
      updates.decided_by_user_id = adminId || null;
    }
    await trx("artist_access_requests").where({ id }).update(updates);
    return { updated: true, currentStatus, targetStatus };
  });
};

const handleDecision = (targetStatus) => async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Invalid id" });
    }
    const result = await updateDecision({
      id: req.params.id,
      targetStatus,
      adminId: req.user?.id,
    });
    if (result.notFound) {
      return res.status(404).json({ error: "not_found", message: "Request not found" });
    }
    if (result.invalidTransition) {
      return res.status(409).json({
        error: "invalid_transition",
        message: `Cannot transition from ${result.currentStatus} to ${targetStatus}`,
      });
    }
    return res.json({
      ok: true,
      id: req.params.id,
      status: targetStatus,
      previousStatus: result.currentStatus,
    });
  } catch (err) {
    next(err);
  }
};

const updateStatus = async (id, status, adminId) => {
  const db = getDb();
  const updates = {
    status,
    decided_at: db.fn.now(),
    decided_by_user_id: adminId || null,
  };
  return db("artist_access_requests")
    .where({ id })
    .update(updates)
    .returning(["id", "status", "decided_at", "decided_by_user_id"]);
};

const policy = requirePolicy("admin_dashboard:write", "artist_access_requests");

const processApproval = async (id, adminId) => {
  return getDb().transaction(async (trx) => {
    const request = await trx("artist_access_requests").where({ id }).first();
    if (!request) {
      return { notFound: true };
    }
    const currentStatus = request.status || "pending";
    if (currentStatus !== "pending") {
      return { invalidTransition: true, currentStatus };
    }
    const requesterUserId = await resolveRequesterUserId(trx, request);
    const { artist, userId } = await createArtistFromRequest(
      trx,
      request,
      requesterUserId
    );
    const updates = {
      status: "approved",
      decided_at: trx.fn.now(),
      decided_by_user_id: adminId || null,
    };
    const columnInfo = await trx("artist_access_requests").columnInfo();
    if (Object.prototype.hasOwnProperty.call(columnInfo, "approved_at")) {
      updates.approved_at = trx.fn.now();
    }
    if (Object.prototype.hasOwnProperty.call(columnInfo, "approved_by")) {
      updates.approved_by = adminId || null;
    }
    const [updatedRequest] = await trx("artist_access_requests")
      .where({ id })
      .update(updates)
      .returning(["id", "status", "decided_at", "decided_by_user_id"]);
    return { request: updatedRequest, artist, userId };
  });
};

const processRejection = async (id, adminId) => {
  const db = getDb();
  return db.transaction(async (trx) => {
    const request = await trx("artist_access_requests").where({ id }).first();
    if (!request) {
      return { notFound: true };
    }
    const currentStatus = request.status || "pending";
    if (currentStatus !== "pending") {
      return { invalidTransition: true, currentStatus };
    }
    const [updatedRequest] = await trx("artist_access_requests")
      .where({ id })
      .update({
        status: "rejected",
        decided_at: trx.fn.now(),
        decided_by_user_id: adminId || null,
      })
      .returning(["id", "status", "decided_at", "decided_by_user_id"]);
    return { request: updatedRequest };
  });
};

ROUTER.post("/:id/approve", requireAuth, policy, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Invalid id" });
    }
    const result = await processApproval(req.params.id, req.user?.id);
    if (result.notFound) {
      return res.status(404).json({ error: "not_found", message: "Request not found" });
    }
    if (result.invalidTransition) {
      return res.status(409).json({
        error: "invalid_transition",
        message: `Cannot transition from ${result.currentStatus} to approved`,
      });
    }
    return res.json({
      ok: true,
      id: req.params.id,
      status: "approved",
      artistId: result.artist?.id ?? null,
      userId: result.userId ?? null,
      request: formatRequestResponse(result.request),
      artist: result.artist
        ? { id: result.artist.id, handle: result.artist.handle, name: result.artist.name }
        : null,
    });
  } catch (err) {
    console.error("[approve_artist_request]", err?.stack || err);
    if (err?.status && err?.error) {
      return res.status(err.status).json({
        error: err.error,
        message: err.message ?? "validation failed",
      });
    }
    return res.status(500).json({
      error: "internal_server_error",
      message: err?.message || "internal error",
    });
  }
});

ROUTER.post("/:id/reject", requireAuth, policy, async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Invalid id" });
    }
    const result = await processRejection(req.params.id, req.user?.id);
    if (result.notFound) {
      return res.status(404).json({ error: "not_found", message: "Request not found" });
    }
    if (result.invalidTransition) {
      return res.status(409).json({
        error: "invalid_transition",
        message: `Cannot transition from ${result.currentStatus} to rejected`,
      });
    }
    return res.json({
      requestId: result.request?.id,
      status: "rejected",
    });
  } catch (err) {
    next(err);
  }
});

ROUTER.post("/:id/deny", requireAuth, policy, handleDecision("rejected"));

module.exports = ROUTER;
