const { getDb } = require("../core/db/db");
const { hashPassword } = require("../utils/password");
const { copyRequestProfilePhotoToArtist } = require("../services/artistAccessRequests.service");
const { sendEmailByTemplate } = require("../services/email.service");
const { buildPublicAppUrl } = require("../services/appPublicUrl.service");
const { PLAN_TYPES } = require("../common/constants");
const {
  ADMIN_REQUEST_LIST_COLUMNS,
  mapRow,
  normalizeForResponse,
  normalizeStatusFilter,
  trim,
  validateApprovalPayload,
} = require("./artistAccessRequests.admin.validators");
const {
  getSubscriptionDateWindow,
  getRequestById,
  updateRequestById,
  getRequestColumns,
  upsertArtistRoleUser,
  createArtistFromRequest,
  createArtistSubscription,
  listRequests,
  countPendingRequests,
} = require("./artistAccessRequests.admin.repository");

const PARTNER_LOGIN_PATH = "/partner/login";
const APPLY_ARTIST_PATH = "/apply/artist";

const sendApprovalEmail = async ({ email, artistName }) => {
  try {
    const recipient = trim(email).toLowerCase();
    if (!recipient) return;
    const loginUrl =
      buildPublicAppUrl({ path: PARTNER_LOGIN_PATH }) || buildPublicAppUrl({ path: "/" });

    const result = await sendEmailByTemplate({
      templateKey: "admin-approved-account",
      to: recipient,
      payload: {
        accountName: artistName,
        loginUrl,
        appUrl: buildPublicAppUrl({ path: "/" }),
      },
      metadata: {
        flow: "admin_account_approved",
      },
    });

    if (result.errorCode && !result.skipped) {
      console.warn("[artist-request-email] approval send failed", result.errorCode);
    }
  } catch (err) {
    console.warn(
      "[artist-request-email] approval send failed",
      err?.code || err?.message || err
    );
  }
};

const sendRejectionEmail = async ({ email, artistName, comment }) => {
  try {
    const recipient = trim(email).toLowerCase();
    if (!recipient) return;
    const appUrl =
      buildPublicAppUrl({ path: APPLY_ARTIST_PATH }) || buildPublicAppUrl({ path: "/" });

    const result = await sendEmailByTemplate({
      templateKey: "admin-rejected-account",
      to: recipient,
      payload: {
        accountName: artistName,
        reason: comment,
        appUrl,
      },
      metadata: {
        flow: "admin_account_rejected",
      },
    });

    if (result.errorCode && !result.skipped) {
      console.warn("[artist-request-email] rejection send failed", result.errorCode);
    }
  } catch (err) {
    console.warn(
      "[artist-request-email] rejection send failed",
      err?.code || err?.message || err
    );
  }
};

const resolveOrCreateArtistUser = async (trx, email, plainPassword) => {
  const normalizedEmail = trim(email).toLowerCase();
  if (!normalizedEmail) {
    throw {
      status: 400,
      error: "validation_error",
      message: "email is required for approval",
    };
  }
  if (!trim(plainPassword)) {
    throw {
      status: 400,
      error: "validation_error",
      message: "password is required for approval",
    };
  }
  const passwordHash = await hashPassword(plainPassword);
  return upsertArtistRoleUser({
    trx,
    email: normalizedEmail,
    passwordHash,
  });
};

const processApproval = async ({ id, adminId, approvalPayload }) => {
  return getDb().transaction(async (trx) => {
    const request = await getRequestById(trx, id);
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

    const user = await resolveOrCreateArtistUser(trx, requestEmail, approvalPayload.password);
    const artist = await createArtistFromRequest({ trx, request, userId: user.id });
    const photoLinkResult = await copyRequestProfilePhotoToArtist({
      db: getDb(),
      trx,
      requestId: id,
      artistId: artist.id,
    });
    console.log("[artist-approve] copy profile photo", {
      requestId: id,
      artistId: artist.id,
      result: photoLinkResult,
    });

    const subscriptionResult = await createArtistSubscription({
      trx,
      artistId: artist.id,
      request,
      approvalPayload,
      adminId,
    });
    if (subscriptionResult.conflict) {
      return { subscriptionConflict: true };
    }

    const requestColumns = await getRequestColumns(trx);
    const updates = { status: "approved" };
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
    if (Object.prototype.hasOwnProperty.call(requestColumns, "approved_plan_type")) {
      updates.approved_plan_type = approvalPayload.final_plan_type;
    }
    if (Object.prototype.hasOwnProperty.call(requestColumns, "approved_by_admin_id")) {
      updates.approved_by_admin_id = adminId || null;
    }
    if (Object.prototype.hasOwnProperty.call(requestColumns, "approved_at")) {
      updates.approved_at = trx.fn.now();
    }
    if (
      Object.prototype.hasOwnProperty.call(requestColumns, "requested_plan_type") &&
      !trim(request.requested_plan_type)
    ) {
      updates.requested_plan_type = PLAN_TYPES.BASIC;
    }

    await updateRequestById(trx, id, updates);

    return {
      status: "approved",
      email: requestEmail,
      artistName: trim(request.artist_name || request.name),
      user,
      artist,
      subscriptionId: subscriptionResult.id,
    };
  });
};

const approveArtistRequestAction = async ({ id, adminId, body }) => {
  const approvalPayload = validateApprovalPayload(body || {});
  const result = await processApproval({ id, adminId, approvalPayload });

  if (result.notFound) {
    return {
      httpStatus: 404,
      payload: { error: "not_found", message: "Request not found" },
    };
  }
  if (result.validationError) {
    return {
      httpStatus: 400,
      payload: { error: "validation_error", message: result.message },
    };
  }
  if (result.invalidTransition) {
    return {
      httpStatus: 409,
      payload: {
        error: "invalid_transition",
        message: `Cannot transition from ${result.currentStatus} to approved`,
      },
    };
  }
  if (result.subscriptionConflict) {
    return {
      httpStatus: 409,
      payload: {
        error: "active_subscription_exists",
        message: "Artist already has an active subscription",
      },
    };
  }

  return { httpStatus: 200, result };
};

const processRejection = async ({ id, adminId, comment }) => {
  return getDb().transaction(async (trx) => {
    const request = await getRequestById(trx, id);
    if (!request) return { notFound: true };

    const currentStatus = normalizeForResponse(request.status);
    if (currentStatus !== "pending") return { invalidTransition: true, currentStatus };

    const requestColumns = await getRequestColumns(trx);
    const updates = { status: "rejected" };
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

    await updateRequestById(trx, id, updates);

    return {
      status: "rejected",
      email: trim(request.email || request.contact_email).toLowerCase(),
      artistName: trim(request.artist_name || request.name),
      comment,
    };
  });
};

const listAdminArtistAccessRequests = async ({ query }) => {
  const status = normalizeStatusFilter(query?.status);
  if (!status) {
    return {
      httpStatus: 400,
      payload: { error: "validation_error", message: "Invalid status filter" },
    };
  }

  const page = Math.max(1, Number.parseInt(query?.page?.toString() || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(query?.pageSize?.toString() || "20", 10) || 20)
  );
  const { rows, total } = await listRequests({ db: getDb(), status, page, pageSize });
  const items = rows.map(mapRow);
  return { httpStatus: 200, payload: { items, total, page, pageSize } };
};

const getPendingCount = async () => {
  const count = await countPendingRequests(getDb());
  return { httpStatus: 200, payload: { count } };
};

module.exports = {
  approveArtistRequestAction,
  processApproval,
  processRejection,
  listAdminArtistAccessRequests,
  getPendingCount,
  sendApprovalEmail,
  sendRejectionEmail,
  getSubscriptionDateWindow,
  mapRow,
  ADMIN_REQUEST_LIST_COLUMNS,
};
