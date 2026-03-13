const { PLAN_TYPES, PLAN_TYPE_VALUES, normalizePlan } = require("../common/constants");
const { toAbsolutePublicUrl } = require("../utils/publicUrl");

const STATUS_OPTIONS = new Set(["pending", "approved", "rejected"]);
const LIST_STATUS_OPTIONS = new Set(["pending", "approved", "rejected", "denied"]);

const ADMIN_REQUEST_LIST_COLUMNS = [
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
  "requested_plan_type",
  "approved_plan_type",
  "status",
  "source",
  "label_id",
  "rejection_comment",
  "created_at",
  "updated_at",
];

const isUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const validationError = (message) => {
  const error = new Error(message || "validation_error");
  error.status = 400;
  error.code = "validation_error";
  return error;
};

const validateApprovalPayload = (raw = {}) => {
  const body = raw && typeof raw === "object" ? raw : {};
  const finalPlanType = normalizePlan(
    body.final_plan_type || body.finalPlanType || body.approved_plan_type
  );
  if (!PLAN_TYPE_VALUES.includes(finalPlanType)) {
    throw validationError(`final_plan_type must be one of: ${PLAN_TYPE_VALUES.join(", ")}`);
  }
  if (
    finalPlanType === PLAN_TYPES.PREMIUM &&
    normalizePlan(process.env.PREMIUM_PLAN_ENABLED) !== "true"
  ) {
    throw validationError(`final_plan_type "${PLAN_TYPES.PREMIUM}" is not enabled`);
  }

  const password = trim(body.password || body.temp_password || body.generated_password);
  if (!password) {
    throw validationError("password is required for approval");
  }

  if (finalPlanType === PLAN_TYPES.BASIC) {
    return {
      final_plan_type: PLAN_TYPES.BASIC,
      payment_mode: "NA",
      transaction_id: "NA",
      password,
    };
  }

  const paymentMode = trim(body.payment_mode || body.paymentMode).toLowerCase();
  const transactionId = trim(body.transaction_id || body.transactionId);
  if (!paymentMode || !transactionId) {
    throw validationError("payment_mode and transaction_id are required");
  }

  return {
    final_plan_type: finalPlanType,
    payment_mode: paymentMode,
    transaction_id: transactionId,
    password,
  };
};

const normalizeForResponse = (status) => (status === "denied" ? "rejected" : status || "pending");

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
  profilePhotoUrl: toAbsolutePublicUrl(
    row.profile_photo_media_url || row.profile_photo_url || row.profile_photo_path || ""
  ),
  messageForFans: row.message_for_fans || "",
  requested_plan_type: row.requested_plan_type || "basic",
  requestedPlanType: row.requested_plan_type || "basic",
  approved_plan_type: row.approved_plan_type || null,
  approvedPlanType: row.approved_plan_type || null,
  rejectionComment: row.rejection_comment || "",
});

const pickExistingColumns = (columnInfo, candidates) =>
  candidates.filter((column) => Object.prototype.hasOwnProperty.call(columnInfo, column));

const slugifyHandle = (value) => {
  const base =
    (value || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "artist";
  return base;
};

const normalizeRequestedPlanType = (request) => {
  const requested = normalizePlan(request?.requested_plan_type);
  if (PLAN_TYPE_VALUES.includes(requested)) {
    return requested;
  }
  return PLAN_TYPES.BASIC;
};

module.exports = {
  STATUS_OPTIONS,
  LIST_STATUS_OPTIONS,
  ADMIN_REQUEST_LIST_COLUMNS,
  isUuid,
  trim,
  validationError,
  validateApprovalPayload,
  normalizeForResponse,
  normalizeStatusFilter,
  mapRow,
  pickExistingColumns,
  slugifyHandle,
  normalizeRequestedPlanType,
};
