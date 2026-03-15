const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../../../core/db/db");
const {
  assertAdminArtistDirectorySchema,
  assertAdminArtistSubscriptionSchema,
} = require("../../../core/db/schemaContract");
const { requireAuth } = require("../../../core/http/auth.middleware");
const { requirePolicy } = require("../../../core/http/policy.middleware");
const { toAbsolutePublicUrl } = require("../../../utils/publicUrl");

let fetchActiveArtistSubscriptionPayloadRef = null;
let updateArtistSubscriptionActionRef = null;
let reconcileArtistUserMappingRef = null;

const registerAdminArtistRoutes = (router, deps = {}) => {
  const { ensureAdmin } = deps;
  const LINK_POLICY = requirePolicy("admin:ownership:write", "system");

const sortMappingsDeterministically = (rows = []) =>
  rows
    .filter(Boolean)
    .slice()
    .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));

const readArtistUserMappings = async (db, userId) =>
  sortMappingsDeterministically(
    await db("artist_user_map")
      .where({ user_id: userId })
      .select("id", "artist_id", "user_id")
  );

const deleteArtistUserMappingsByIds = async (db, ids = []) => {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedIds.length === 0) return 0;
  return db("artist_user_map").whereIn("id", normalizedIds).delete();
};

const insertArtistUserMapping = async (db, { artistId, userId }) => {
  const mappingId = randomUUID();
  try {
    await db("artist_user_map").insert({
      id: mappingId,
      user_id: userId,
      artist_id: artistId,
    });
    return { inserted: true, mappingId };
  } catch (err) {
    if (err?.code === "23505") {
      return { inserted: false, mappingId: null };
    }
    throw err;
  }
};

const reconcileArtistUserMapping = async ({ db, artistId, userId }) => {
  if (!db || !artistId || !userId) {
    throw new Error("invalid_mapping_input");
  }

  const run = async (trx) => {
    const existingRows = await readArtistUserMappings(trx, userId);
    const sameArtistRows = existingRows.filter((row) => row.artist_id === artistId);

    if (sameArtistRows.length > 0) {
      const keeper = sameArtistRows[0];
      const staleIds = existingRows
        .filter((row) => String(row?.id || "") !== String(keeper.id || ""))
        .map((row) => row.id);
      await deleteArtistUserMappingsByIds(trx, staleIds);
      return {
        idempotent: staleIds.length === 0,
        linked: true,
      };
    }

    if (existingRows.length > 0) {
      await deleteArtistUserMappingsByIds(
        trx,
        existingRows.map((row) => row.id)
      );
    }

    await insertArtistUserMapping(trx, { artistId, userId });

    const afterRows = await readArtistUserMappings(trx, userId);
    const targetRows = afterRows.filter((row) => row.artist_id === artistId);
    if (targetRows.length === 0) {
      const fallback = afterRows[0];
      if (fallback) {
        await deleteArtistUserMappingsByIds(
          trx,
          afterRows
            .filter((row) => String(row?.id || "") !== String(fallback.id || ""))
            .map((row) => row.id)
        );
        try {
          await trx("artist_user_map")
            .where({ id: fallback.id })
            .update({ artist_id: artistId });
        } catch (err) {
          if (err?.code !== "23505") throw err;
        }
      } else {
        await insertArtistUserMapping(trx, { artistId, userId });
      }
    }

    const finalRows = await readArtistUserMappings(trx, userId);
    const finalTargetRows = finalRows.filter((row) => row.artist_id === artistId);
    if (finalTargetRows.length === 0) {
      throw new Error("artist_user_map_reconcile_failed");
    }

    const finalKeeper = finalTargetRows[0];
    const staleIds = finalRows
      .filter((row) => String(row?.id || "") !== String(finalKeeper.id || ""))
      .map((row) => row.id);
    await deleteArtistUserMappingsByIds(trx, staleIds);

    return {
      idempotent: false,
      linked: true,
    };
  };

  if (typeof db.transaction === "function") {
    return db.transaction(async (trx) => run(trx));
  }
  return run(db);
};

const handleLinkArtistUser = async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const { artistId } = req.params;
    const rawUserId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    const rawEmail =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : typeof req.body?.userEmail === "string"
        ? req.body.userEmail.trim().toLowerCase()
        : "";

    if (!artistId || (!rawUserId && !rawEmail)) {
      return res.status(400).json({ error: "invalid_request" });
    }
    const [artist] = await db("artists").where({ id: artistId }).select("id");
    if (!artist) {
      return res.status(404).json({ error: "artist_not_found" });
    }

    let user = null;
    if (rawUserId) {
      [user] = await db("users").where({ id: rawUserId }).select("id", "role");
    }
    if (!user && rawEmail) {
      [user] = await db("users")
        .whereRaw("lower(email) = ?", [rawEmail])
        .select("id", "role");
    }
    if (!user && !rawEmail && rawUserId.includes("@")) {
      [user] = await db("users")
        .whereRaw("lower(email) = ?", [rawUserId.toLowerCase()])
        .select("id", "role");
    }

    if (!user) {
      return res.status(404).json({ error: "user_not_found" });
    }
    if (user.role !== "artist") {
      return res.status(400).json({ error: "user_not_artist" });
    }
    await reconcileArtistUserMapping({
      db,
      artistId,
      userId: user.id,
    });
    res.json({ ok: true, userId: user.id, artistId });
  } catch (err) {
    next(err);
  }
};


router.post(
  "/artists/:artistId/link-user",
  requireAuth,
  LINK_POLICY,
  express.json(),
  handleLinkArtistUser
);

const toIsoOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const normalizeRequestStatus = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "denied") return "rejected";
  return normalized || "pending";
};

const ARTIST_STATUS_OPTIONS = [
  "approved",
  "active",
  "inactive",
  "rejected",
  "onboarded",
  "pending",
];

const normalizeArtistStatusInput = (status) => {
  const normalized = normalizeRequestStatus(status);
  return ARTIST_STATUS_OPTIONS.includes(normalized) ? normalized : "";
};

const buildArtistStatus = (requestStatus, linkedUsersCount) => {
  const normalized = normalizeRequestStatus(requestStatus);
  if (normalized === "approved") return "approved";
  if (normalized === "rejected" || normalized === "denied") return "rejected";
  if (linkedUsersCount > 0) return "active";
  return "onboarded";
};

const normalizeEmailOrNull = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  return text || null;
};

const normalizeSocialRows = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const platform = String(entry?.platform ?? entry?.name ?? "").trim();
        const resolvedValue = String(
          entry?.value ??
            entry?.profileLink ??
            entry?.url ??
            entry?.link ??
            entry?.handle ??
            ""
        ).trim();
        if (!platform && !resolvedValue) return null;
        return {
          platform,
          value: resolvedValue,
          profileLink: resolvedValue,
        };
      })
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([platform, resolvedValue]) => {
        const platformText = String(platform ?? "").trim();
        const valueText = String(resolvedValue ?? "").trim();
        if (!platformText && !valueText) return null;
        return {
          platform: platformText,
          value: valueText,
          profileLink: valueText,
        };
      })
      .filter(Boolean);
  }
  return [];
};

const isSchemaContractMissingError = (err) => err?.code === "SCHEMA_CONTRACT_MISSING";

const sendSchemaNotReady = (res) =>
  res.status(500).json({
    error: "schema_not_ready",
    message: "Required database migrations have not been applied.",
  });

const fetchAdminArtistDetailPayload = async (db, artistId) => {
  await assertAdminArtistDirectorySchema(db);
  const artist = await db("artists").where({ id: artistId }).first();
  if (!artist) {
    return {
      statusCode: 404,
      body: { error: "not_found", message: "Artist not found" },
    };
  }

  const linkedUser = await db("artist_user_map as aum")
    .leftJoin("users as u", "u.id", "aum.user_id")
    .where("aum.artist_id", artistId)
    .select("u.email")
    .first();
  const email = normalizeEmailOrNull(artist.email) || normalizeEmailOrNull(linkedUser?.email);

  const latestApprovedRequest = await db("artist_access_requests")
    .where("status", "approved")
    .whereRaw("lower(trim(handle)) = lower(trim(?))", [artist.handle])
    .orderBy("created_at", "desc")
    .first();

  const mediaRow = await db("entity_media_links as eml")
    .leftJoin("media_assets as ma", "ma.id", "eml.media_asset_id")
    .where("eml.entity_type", "artist")
    .andWhere("eml.role", "profile_photo")
    .andWhere("eml.entity_id", artistId)
    .orderBy("eml.sort_order", "asc")
    .select("ma.public_url")
    .first();
  const profilePhotoUrl =
    toAbsolutePublicUrl(mediaRow?.public_url) || toAbsolutePublicUrl(artist.profile_photo_url);

  const status =
    String(artist.status ?? latestApprovedRequest?.status ?? "active").trim().toLowerCase() ||
    "active";
  const isFeatured = Boolean(artist.is_featured);
  const phone = String(artist.phone ?? latestApprovedRequest?.phone ?? "").trim();
  const aboutMe = String(artist.about_me ?? latestApprovedRequest?.about_me ?? "").trim();
  const messageForFans = String(
    artist.message_for_fans ?? latestApprovedRequest?.message_for_fans ?? ""
  ).trim();
  const socials = artist.socials ?? latestApprovedRequest?.socials ?? [];
  const normalizedSocials = normalizeSocialRows(socials);

  const capabilities = {
    canEditName: true,
    canEditHandle: true,
    canEditEmail: true,
    canEditStatus: true,
    canEditFeatured: true,
    canEditPhone: true,
    canEditAboutMe: true,
    canEditMessageForFans: true,
    canEditSocials: true,
    canEditProfilePhoto: true,
    canUploadProfilePhoto: true,
  };

  return {
    statusCode: 200,
    body: {
      id: artist.id,
      name: artist.name ?? artist.artist_name ?? "",
      handle: String(artist.handle ?? "").replace(/^@/, ""),
      status,
      is_featured: isFeatured,
      isFeatured,
      email,
      phone,
      about: aboutMe,
      about_me: aboutMe,
      aboutMe,
      message_for_fans: messageForFans,
      messageForFans,
      socials: normalizedSocials,
      profile_photo_url: profilePhotoUrl,
      profilePhotoUrl,
      statusOptions: ARTIST_STATUS_OPTIONS,
      capabilities,
    },
  };
};

const toDateOnlyOrNull = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const SUBSCRIPTION_STATUS_VALUES = new Set(["active", "expired", "cancelled"]);
const ADVANCED_PAYMENT_MODE_VALUES = new Set(["cash", "online"]);

const normalizeSubscriptionStatus = (value) =>
  String(value ?? "").trim().toLowerCase();
const normalizePaymentMode = (value) => String(value ?? "").trim().toLowerCase();
const normalizePlanType = (value) => String(value ?? "").trim().toLowerCase();
const isIsoDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());

const formatSubscriptionPayload = (row, fallbackArtistId = "") => {
  if (!row) return null;
  return {
    id: row.id || null,
    artistId: row.artist_id || fallbackArtistId || null,
    requestedPlanType: row.requested_plan_type || null,
    approvedPlanType: row.approved_plan_type || null,
    startDate: toDateOnlyOrNull(row.start_date),
    endDate: toDateOnlyOrNull(row.end_date),
    paymentMode: row.payment_mode || null,
    transactionId: row.transaction_id || null,
    status: row.status || null,
    approvedAt: toIsoOrNull(row.approved_at),
    approvedByAdminId: row.approved_by_admin_id || null,
  };
};

const fetchActiveArtistSubscriptionPayload = async (db, artistId) => {
  await assertAdminArtistSubscriptionSchema(db);
  const artist = await db("artists").where({ id: artistId }).first("id");
  if (!artist?.id) {
    return {
      statusCode: 404,
      body: { error: "not_found", message: "Artist not found" },
    };
  }

  const active = await db("artist_subscriptions")
    .where({
      artist_id: artistId,
      status: "active",
    })
    .orderBy("approved_at", "desc")
    .orderBy("created_at", "desc")
    .first();

  return {
    statusCode: 200,
    body: formatSubscriptionPayload(active, artistId),
  };
};

const updateArtistSubscriptionAction = async ({ db, subscriptionId, payload = {} }) => {
  const subscriptionIdText = String(subscriptionId || "").trim();
  if (!subscriptionIdText) {
    return {
      statusCode: 400,
      body: { error: "validation_error", message: "subscription id is required" },
    };
  }

  await assertAdminArtistSubscriptionSchema(db);
  const existing = await db("artist_subscriptions").where({ id: subscriptionIdText }).first();
  if (!existing?.id) {
    return {
      statusCode: 404,
      body: { error: "not_found", message: "Subscription not found" },
    };
  }

  const hasPayloadKey = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  const blockedKeys = [
    "artist_id",
    "artistId",
    "requested_plan_type",
    "requestedPlanType",
    "approved_plan_type",
    "approvedPlanType",
    "start_date",
    "startDate",
    "approved_at",
    "approvedAt",
    "approved_by_admin_id",
    "approvedByAdminId",
  ].filter((key) => hasPayloadKey(key));
  if (blockedKeys.length > 0) {
    return {
      statusCode: 400,
      body: {
        error: "validation_error",
        message: `Fields are read-only: ${blockedKeys.join(", ")}`,
      },
    };
  }

  const next = {
    status: normalizeSubscriptionStatus(existing.status),
    endDate: toDateOnlyOrNull(existing.end_date),
    startDate: toDateOnlyOrNull(existing.start_date),
    paymentMode: String(existing.payment_mode ?? "").trim(),
    transactionId: String(existing.transaction_id ?? "").trim(),
  };

  if (hasPayloadKey("status")) {
    const normalized = normalizeSubscriptionStatus(payload.status);
    if (!SUBSCRIPTION_STATUS_VALUES.has(normalized)) {
      return {
        statusCode: 400,
        body: {
          error: "validation_error",
          message: "status must be one of: active, expired, cancelled",
        },
      };
    }
    next.status = normalized;
  }

  if (hasPayloadKey("endDate") || hasPayloadKey("end_date")) {
    const rawEndDate = String(payload.endDate ?? payload.end_date ?? "").trim();
    if (!isIsoDateOnly(rawEndDate)) {
      return {
        statusCode: 400,
        body: { error: "validation_error", message: "endDate must be YYYY-MM-DD" },
      };
    }
    next.endDate = rawEndDate;
  }

  if (!next.startDate || !next.endDate || next.endDate < next.startDate) {
    return {
      statusCode: 400,
      body: {
        error: "validation_error",
        message: "endDate must be greater than or equal to startDate",
      },
    };
  }

  const approvedPlanType = normalizePlanType(existing.approved_plan_type);
  const paymentModeProvided = hasPayloadKey("payment_mode") || hasPayloadKey("paymentMode");
  const transactionIdProvided = hasPayloadKey("transaction_id") || hasPayloadKey("transactionId");
  const statusProvided = hasPayloadKey("status");
  const endDateProvided = hasPayloadKey("endDate") || hasPayloadKey("end_date");
  const hasNonPaymentMutation = statusProvided || endDateProvided;

  if (approvedPlanType === "basic") {
    if ((paymentModeProvided || transactionIdProvided) && !hasNonPaymentMutation) {
      return {
        statusCode: 400,
        body: {
          error: "validation_error",
          message: "Payment fields are fixed to NA for basic plan subscriptions",
        },
      };
    }
    next.paymentMode = "NA";
    next.transactionId = "NA";
  } else if (approvedPlanType === "advanced") {
    if (paymentModeProvided || transactionIdProvided) {
      const rawPaymentMode = normalizePaymentMode(payload.payment_mode ?? payload.paymentMode);
      const rawTransactionId = String(
        payload.transaction_id ?? payload.transactionId ?? ""
      ).trim();
      if (!ADVANCED_PAYMENT_MODE_VALUES.has(rawPaymentMode)) {
        return {
          statusCode: 400,
          body: {
            error: "validation_error",
            message: "paymentMode must be one of: cash, online",
          },
        };
      }
      if (!rawTransactionId) {
        return {
          statusCode: 400,
          body: {
            error: "validation_error",
            message: "transactionId is required for advanced plan",
          },
        };
      }
      next.paymentMode = rawPaymentMode;
      next.transactionId = rawTransactionId;
    } else {
      const currentPaymentMode = normalizePaymentMode(next.paymentMode);
      const currentTransactionId = String(next.transactionId || "").trim();
      if (
        !ADVANCED_PAYMENT_MODE_VALUES.has(currentPaymentMode) ||
        !currentTransactionId
      ) {
        return {
          statusCode: 400,
          body: {
            error: "validation_error",
            message:
              "Advanced plan requires valid paymentMode (cash|online) and transactionId",
          },
        };
      }
      next.paymentMode = currentPaymentMode;
      next.transactionId = currentTransactionId;
    }
  } else if (paymentModeProvided || transactionIdProvided) {
    return {
      statusCode: 400,
      body: {
        error: "validation_error",
        message: "payment fields are editable only for advanced plan subscriptions",
      },
    };
  }

  if (next.status === "active") {
    const conflict = await db("artist_subscriptions")
      .where({ artist_id: existing.artist_id, status: "active" })
      .andWhereNot("id", subscriptionIdText)
      .first("id");
    if (conflict?.id) {
      return {
        statusCode: 409,
        body: {
          error: "active_subscription_exists",
          message: "Artist already has another active subscription",
        },
      };
    }
  }

  const updatePayload = {};
  if (next.endDate !== toDateOnlyOrNull(existing.end_date)) {
    updatePayload.end_date = next.endDate;
  }
  if (next.status !== normalizeSubscriptionStatus(existing.status)) {
    updatePayload.status = next.status;
  }
  if (next.paymentMode !== String(existing.payment_mode ?? "").trim()) {
    updatePayload.payment_mode = next.paymentMode;
  }
  if (next.transactionId !== String(existing.transaction_id ?? "").trim()) {
    updatePayload.transaction_id = next.transactionId;
  }
  updatePayload.updated_at = db.fn.now();

  if (Object.keys(updatePayload).length === 1 && updatePayload.updated_at) {
    return {
      statusCode: 400,
      body: { error: "no_fields", message: "No subscription changes detected" },
    };
  }

  const updatedRows = await db("artist_subscriptions")
    .where({ id: subscriptionIdText })
    .update(updatePayload)
    .returning("*");
  const updated = updatedRows?.[0] || null;

  return {
    statusCode: 200,
    body: formatSubscriptionPayload(updated, existing.artist_id),
  };
};

router.get("/artists", requireAuth, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const db = getDb();
    const artistColumns = await db("artists").columnInfo();
    const artistSelects = ["id", "name", "handle", "created_at"];
    if (Object.prototype.hasOwnProperty.call(artistColumns, "status")) {
      artistSelects.push("status");
    }
    if (Object.prototype.hasOwnProperty.call(artistColumns, "email")) {
      artistSelects.push("email");
    }
    if (Object.prototype.hasOwnProperty.call(artistColumns, "phone")) {
      artistSelects.push("phone");
    }
    if (Object.prototype.hasOwnProperty.call(artistColumns, "is_featured")) {
      artistSelects.push("is_featured");
    }
    const rows = await db("artists")
      .select(artistSelects)
      .orderBy("created_at", "desc")
      .limit(200);

    const artistIds = rows.map((row) => row.id).filter(Boolean);
    const linkedUsersCountByArtistId = new Map();
    const linkedEmailByArtistId = new Map();
    const normalizeText = (value) => String(value ?? "").trim();
    const normalizeLower = (value) => normalizeText(value).toLowerCase();

    if (artistIds.length > 0) {
      const linkedRows = await db("artist_user_map as aum")
        .leftJoin("users as u", "u.id", "aum.user_id")
        .whereIn("aum.artist_id", artistIds)
        .select("aum.artist_id as artistId", "aum.user_id as userId", "u.email as userEmail");

      for (const linkedRow of linkedRows) {
        const artistId = linkedRow?.artistId;
        if (!artistId) continue;
        const prevCount = linkedUsersCountByArtistId.get(artistId) || 0;
        if (linkedRow?.userId) {
          linkedUsersCountByArtistId.set(artistId, prevCount + 1);
        } else {
          linkedUsersCountByArtistId.set(artistId, prevCount);
        }

        const email = normalizeText(linkedRow?.userEmail);
        if (email && !linkedEmailByArtistId.has(artistId)) {
          linkedEmailByArtistId.set(artistId, email);
        }
      }
    }

    const requestStatusByArtistId = new Map();
    const requestPhoneByArtistId = new Map();
    if (artistIds.length > 0) {
      const requestRows = await db("artist_access_requests")
        .select("handle", "email", "status", "phone", "created_at")
        .orderBy("created_at", "desc");

      const artistIdsByHandle = new Map();
      const artistIdsByEmail = new Map();
      for (const row of rows) {
        const rowHandle = normalizeLower(row?.handle);
        const rowEmail = normalizeLower(row?.email || linkedEmailByArtistId.get(row?.id));
        if (rowHandle && !artistIdsByHandle.has(rowHandle)) {
          artistIdsByHandle.set(rowHandle, row.id);
        }
        if (rowEmail && !artistIdsByEmail.has(rowEmail)) {
          artistIdsByEmail.set(rowEmail, row.id);
        }
      }

      for (const requestRow of requestRows) {
        let matchedArtistId = null;
        const handleKey = normalizeLower(requestRow?.handle);
        if (handleKey && artistIdsByHandle.has(handleKey)) {
          matchedArtistId = artistIdsByHandle.get(handleKey);
        }
        if (!matchedArtistId) {
          const emailKey = normalizeLower(requestRow?.email);
          if (emailKey && artistIdsByEmail.has(emailKey)) {
            matchedArtistId = artistIdsByEmail.get(emailKey);
          }
        }
        if (!matchedArtistId) continue;

        if (!requestStatusByArtistId.has(matchedArtistId)) {
          requestStatusByArtistId.set(matchedArtistId, normalizeRequestStatus(requestRow?.status));
        }
        if (!requestPhoneByArtistId.has(matchedArtistId)) {
          const phone = normalizeText(requestRow?.phone);
          if (phone) requestPhoneByArtistId.set(matchedArtistId, phone);
        }
      }
    }

    const items = rows.map((r) => ({
      id: r.id,
      name: normalizeText(r.name ?? r.artist_name),
      handle: normalizeText(r.handle),
      status: normalizeText(r.status)
        ? normalizeRequestStatus(r.status)
        : buildArtistStatus(
            requestStatusByArtistId.get(r.id),
            linkedUsersCountByArtistId.get(r.id) || 0
          ),
      is_featured: Boolean(r.is_featured),
      isFeatured: Boolean(r.is_featured),
      email: normalizeText(r.email) || linkedEmailByArtistId.get(r.id) || "",
      phone: normalizeText(r.phone) || requestPhoneByArtistId.get(r.id) || "",
      createdAt: r.created_at ?? null,
    }));

    console.log("[admin artists] ok count=", items.length);
    return res.json({ items, total: rows.length });
  } catch (err) {
    console.error("[admin artists] error", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

router.get("/artists/:artistId/subscription", requireAuth, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const artistId = String(req.params.artistId || "").trim();
    if (!artistId) {
      return res.status(400).json({ error: "validation_error", message: "artist id is required" });
    }

    const db = getDb();
    const subscriptionPayload = await fetchActiveArtistSubscriptionPayload(db, artistId);
    return res.status(subscriptionPayload.statusCode).json(subscriptionPayload.body);
  } catch (err) {
    if (isSchemaContractMissingError(err)) {
      return sendSchemaNotReady(res);
    }
    console.error("[admin artist subscription] error", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

router.patch("/artist-subscriptions/:subscriptionId", requireAuth, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const subscriptionId = String(req.params.subscriptionId || "").trim();
    if (!subscriptionId) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "subscription id is required" });
    }

    const db = getDb();
    const result = await db.transaction(async (trx) =>
      updateArtistSubscriptionAction({
        db: trx,
        subscriptionId,
        payload: req.body || {},
      })
    );
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        error: "active_subscription_exists",
        message: "Artist already has another active subscription",
      });
    }
    if (isSchemaContractMissingError(err)) {
      return sendSchemaNotReady(res);
    }
    console.error("[admin artist subscription patch] error", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

router.get("/artists/:id", requireAuth, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const artistId = String(req.params.id || "").trim();
    if (!artistId) {
      return res.status(400).json({ error: "validation_error", message: "artist id is required" });
    }
    const db = getDb();
    const detail = await fetchAdminArtistDetailPayload(db, artistId);
    return res.status(detail.statusCode).json(detail.body);
  } catch (err) {
    if (isSchemaContractMissingError(err)) {
      return sendSchemaNotReady(res);
    }
    console.error("[admin artist detail] error", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

router.patch("/artists/:id", requireAuth, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const artistId = String(req.params.id || "").trim();
    if (!artistId) {
      return res.status(400).json({ error: "validation_error", message: "artist id is required" });
    }

    const payload = req.body || {};
    const db = getDb();
    await assertAdminArtistDirectorySchema(db);
    const artist = await db("artists").where({ id: artistId }).first();
    if (!artist) {
      return res.status(404).json({ error: "not_found", message: "Artist not found" });
    }

    const hasPayloadKey = (key) => Object.prototype.hasOwnProperty.call(payload, key);
    const asText = (value) => String(value ?? "").trim();
    const asNullableText = (value) => {
      const text = asText(value);
      return text ? text : null;
    };
    const validateStringField = (keys, field) => {
      for (const key of keys) {
        if (!hasPayloadKey(key)) continue;
        const value = payload[key];
        if (value == null) continue;
        if (typeof value !== "string") {
          return res.status(400).json({
            error: "validation",
            details: [{ field, message: `${field} must be a string` }],
          });
        }
      }
      return null;
    };

    const stringValidation =
      validateStringField(["name"], "name") ||
      validateStringField(["phone"], "phone") ||
      validateStringField(["about", "about_me", "aboutMe"], "about") ||
      validateStringField(["message_for_fans", "messageForFans"], "message_for_fans") ||
      validateStringField(["profile_photo_url", "profilePhotoUrl"], "profile_photo_url") ||
      validateStringField(["email"], "email");
    if (stringValidation) return stringValidation;

    const patch = {};
    let hasAnyUpdate = false;
    const ignoredFields = [];

    if (hasPayloadKey("is_featured") || hasPayloadKey("isFeatured")) {
      const rawFeatured = hasPayloadKey("is_featured")
        ? payload.is_featured
        : payload.isFeatured;
      if (typeof rawFeatured !== "boolean") {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "is_featured", message: "is_featured must be a boolean" }],
        });
      }
      patch.is_featured = rawFeatured;
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("name")) {
      const name = asText(payload.name);
      if (name.length < 2) {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "name", message: "name must be at least 2 characters" }],
        });
      }
      patch.name = name;
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("handle")) {
      const handle = asText(payload.handle).replace(/^@+/, "");
      if (!handle) {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "handle", message: "handle cannot be empty" }],
        });
      }
      const taken = await db("artists")
        .whereRaw("lower(trim(handle)) = lower(trim(?))", [handle])
        .andWhereNot("id", artistId)
        .select("id")
        .first();
      if (taken) {
        return res.status(409).json({
          error: "conflict",
          details: [{ field: "handle", message: "handle is already in use" }],
        });
      }
      patch.handle = handle;
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("status")) {
      const status = normalizeArtistStatusInput(payload.status);
      if (!status) {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "status", message: `status must be one of: ${ARTIST_STATUS_OPTIONS.join(", ")}` }],
        });
      }
      patch.status = status;
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("phone")) {
      patch.phone = asNullableText(payload.phone);
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("about") || hasPayloadKey("about_me") || hasPayloadKey("aboutMe")) {
      patch.about_me = asNullableText(payload.about ?? payload.about_me ?? payload.aboutMe);
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("message_for_fans") || hasPayloadKey("messageForFans")) {
      patch.message_for_fans = asNullableText(
        payload.message_for_fans ?? payload.messageForFans
      );
      hasAnyUpdate = true;
    }

    if (hasPayloadKey("socials")) {
      const rawSocials = payload.socials;
      const parsedSocials =
        typeof rawSocials === "string"
          ? (() => {
              try {
                return JSON.parse(rawSocials);
              } catch (_err) {
                return null;
              }
            })()
          : rawSocials;
      let normalizedSocials = [];
      if (Array.isArray(parsedSocials)) {
        normalizedSocials = parsedSocials
          .map((entry) => ({
            platform: asText(entry?.platform || entry?.name),
            value: asText(
              entry?.profileLink || entry?.url || entry?.link || entry?.value || entry?.handle
            ),
          }))
          .map((entry) => ({
            platform: entry.platform,
            value: entry.value,
            profileLink: entry.value,
          }))
          .filter((entry) => entry.platform || entry.value);
      } else if (parsedSocials && typeof parsedSocials === "object") {
        normalizedSocials = Object.entries(parsedSocials)
          .map(([platform, value]) => ({
            platform: asText(platform),
            value: asText(value),
          }))
          .map((entry) => ({
            platform: entry.platform,
            value: entry.value,
            profileLink: entry.value,
          }))
          .filter((entry) => entry.platform || entry.value);
      } else if (parsedSocials == null) {
        normalizedSocials = [];
      } else {
        return res.status(400).json({
          error: "validation",
          details: [{ field: "socials", message: "socials must be an array or object map" }],
        });
      }
      patch.socials = db.raw("?::jsonb", [JSON.stringify(normalizedSocials)]);
      hasAnyUpdate = true;
    }

    const emailProvided = hasPayloadKey("email");
    const profilePhotoProvided =
      hasPayloadKey("profile_photo_url") ||
      hasPayloadKey("profilePhotoUrl") ||
      hasPayloadKey("profile_photo_media_asset_id") ||
      hasPayloadKey("profilePhotoMediaAssetId");

    await db.transaction(async (trx) => {
      if (Object.keys(patch).length > 0) {
        await trx("artists").where({ id: artistId }).update(patch);
      }

      if (emailProvided) {
        const nextEmailRaw = asText(payload.email).toLowerCase();
        if (nextEmailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmailRaw)) {
          throw Object.assign(new Error("validation"), {
            statusCode: 400,
            payload: {
              error: "validation",
              details: [{ field: "email", message: "email must be a valid email address" }],
            },
          });
        }

        await trx("artists").where({ id: artistId }).update({ email: nextEmailRaw || null });
        hasAnyUpdate = true;

        if (nextEmailRaw) {
          const linked = await trx("artist_user_map")
            .where({ artist_id: artistId })
            .select("user_id")
            .first();
          if (linked?.user_id) {
            await trx("users").where({ id: linked.user_id }).update({ email: nextEmailRaw });
            hasAnyUpdate = true;
          }
        }
      }

      if (profilePhotoProvided) {
        const requestedUrlRaw = asText(payload.profile_photo_url ?? payload.profilePhotoUrl);
        const requestedUrl = requestedUrlRaw ? toAbsolutePublicUrl(requestedUrlRaw) : "";
        const requestedMediaAssetId = asText(
          payload.profile_photo_media_asset_id ?? payload.profilePhotoMediaAssetId
        );

        await trx("artists")
          .where({ id: artistId })
          .update({ profile_photo_url: requestedUrl || null });
        hasAnyUpdate = true;

        await trx("entity_media_links")
          .where({
            entity_type: "artist",
            entity_id: artistId,
            role: "profile_photo",
          })
          .delete();
        hasAnyUpdate = true;

        let mediaAssetId = requestedMediaAssetId || "";
        if (!mediaAssetId && requestedUrl) {
          const mediaRow = await trx("media_assets")
            .select("id")
            .whereIn("public_url", [requestedUrlRaw, requestedUrl])
            .first();
          mediaAssetId = String(mediaRow?.id || "").trim();
        }

        if (mediaAssetId) {
          await trx("entity_media_links").insert({
            id: randomUUID(),
            media_asset_id: mediaAssetId,
            entity_type: "artist",
            entity_id: artistId,
            role: "profile_photo",
            sort_order: 0,
            created_at: trx.fn.now(),
          });
        }
      }
    });

    if (!hasAnyUpdate) {
      if (ignoredFields.length > 0) {
        const detail = await fetchAdminArtistDetailPayload(db, artistId);
        return res.status(detail.statusCode).json({
          ...detail.body,
          ignoredFields: Array.from(new Set(ignoredFields)),
        });
      }
      return res.status(400).json({ error: "no_fields" });
    }

    const detail = await fetchAdminArtistDetailPayload(db, artistId);
    return res.status(detail.statusCode).json({
      ...detail.body,
      ...(ignoredFields.length > 0 ? { ignoredFields: Array.from(new Set(ignoredFields)) } : {}),
    });
  } catch (err) {
    if (isSchemaContractMissingError(err)) {
      return sendSchemaNotReady(res);
    }
    if (err?.statusCode && err?.payload) {
      return res.status(err.statusCode).json(err.payload);
    }
    if (err?.code === "23505") {
      return res.status(409).json({ error: "conflict", message: "duplicate value" });
    }
    console.error("[admin artist update] error", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

  fetchActiveArtistSubscriptionPayloadRef = fetchActiveArtistSubscriptionPayload;
  updateArtistSubscriptionActionRef = updateArtistSubscriptionAction;
  reconcileArtistUserMappingRef = reconcileArtistUserMapping;
};

module.exports = {
  registerAdminArtistRoutes,
  __test: {
    get fetchActiveArtistSubscriptionPayload() {
      return fetchActiveArtistSubscriptionPayloadRef;
    },
    get updateArtistSubscriptionAction() {
      return updateArtistSubscriptionActionRef;
    },
    get reconcileArtistUserMapping() {
      return reconcileArtistUserMappingRef;
    },
  },
};
