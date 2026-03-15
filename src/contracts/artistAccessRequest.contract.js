"use strict";

const { PLAN_TYPE_VALUES, normalizePlan } = require("../common/constants");
const {
  createContractError,
  resolveAliasedField,
} = require("./shared");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const HANDLE_RE = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const LIMITS = {
  artistName: 120,
  handle: 60,
  email: 254,
  phone: 20,
  about: 2500,
  messageForFans: 2500,
};

const trim = (value) => (typeof value === "string" ? value.trim() : "");
const normalizePhoneDigits = (value) => trim(value).replace(/\D+/g, "");
const normalizeHandle = (value) => trim(value).replace(/^@+/, "").toLowerCase();
const normalizeEmail = (value) => trim(value).toLowerCase();

const normalizeSocials = (input) => {
  if (!input) return [];

  let value = input;
  if (Buffer.isBuffer(value)) {
    value = value.toString("utf8");
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === "[object Object]") return [];
    try {
      value = JSON.parse(text);
    } catch (_err) {
      try {
        value = JSON.parse(text.replace(/\\"/g, '"'));
      } catch (_nestedErr) {
        return [];
      }
    }
  }
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => ({
      platform: trim(entry?.platform),
      url: trim(entry?.url),
    }))
    .filter((entry) => entry.platform && entry.url && /^https?:\/\//i.test(entry.url))
    .slice(0, 5);
};

const normalizeArtistAccessCheckQuery = (input = {}) => {
  const handleField = resolveAliasedField({
    input,
    canonicalKey: "handle",
    normalize: normalizeHandle,
  });
  const emailField = resolveAliasedField({
    input,
    canonicalKey: "email",
    normalize: normalizeEmail,
  });
  const phoneField = resolveAliasedField({
    input,
    canonicalKey: "phone",
    normalize: normalizePhoneDigits,
  });

  return {
    dto: {
      handle: handleField.value || "",
      email: emailField.value || "",
      phone: phoneField.value || "",
    },
    meta: {
      legacyKeys: [],
    },
  };
};

const validateArtistAccessCheckQuery = (payload = {}) => {
  if (payload.handle || payload.email || payload.phone) return payload;
  throw createContractError({
    code: "validation",
    message: "handle, email, or phone is required",
    details: [{ field: "query", message: "handle, email, or phone is required" }],
  });
};

const normalizeArtistAccessSubmissionPayload = (input = {}) => {
  // Transitional aliases are scoped per workflow and should be removed in the
  // 2026-Q3 compatibility cleanup once canonical clients are confirmed.
  const artistNameField = resolveAliasedField({
    input,
    canonicalKey: "artist_name",
    aliases: [{ key: "artistName" }],
    normalize: trim,
  });
  const emailField = resolveAliasedField({
    input,
    canonicalKey: "email",
    aliases: [{ key: "contactEmail" }],
    normalize: normalizeEmail,
  });
  const phoneField = resolveAliasedField({
    input,
    canonicalKey: "phone",
    aliases: [{ key: "contactPhone" }],
    normalize: normalizePhoneDigits,
  });
  const aboutField = resolveAliasedField({
    input,
    canonicalKey: "about",
    aliases: [{ key: "aboutMe" }],
    normalize: trim,
  });
  const messageForFansField = resolveAliasedField({
    input,
    canonicalKey: "message_for_fans",
    aliases: [{ key: "messageForFans" }],
    normalize: trim,
  });
  const requestedPlanTypeField = resolveAliasedField({
    input,
    canonicalKey: "requested_plan_type",
    aliases: [{ key: "requestedPlanType" }],
    normalize: normalizePlan,
  });

  return {
    dto: {
      artist_name: artistNameField.value || "",
      handle: normalizeHandle(input.handle),
      email: emailField.value || "",
      phone: phoneField.value || "",
      about: aboutField.value || "",
      message_for_fans: messageForFansField.value || "",
      socials: normalizeSocials(input.socials),
      requested_plan_type: requestedPlanTypeField.value || "",
      has_payment_fields: [
        "payment_mode",
        "paymentMode",
        "transaction_id",
        "transactionId",
      ].some((key) => Object.prototype.hasOwnProperty.call(input, key)),
    },
    meta: {
      legacyKeys: [
        ...artistNameField.legacyKeys,
        ...emailField.legacyKeys,
        ...phoneField.legacyKeys,
        ...aboutField.legacyKeys,
        ...messageForFansField.legacyKeys,
        ...requestedPlanTypeField.legacyKeys,
      ],
      deprecations: [
        ...artistNameField.deprecations,
        ...emailField.deprecations,
        ...phoneField.deprecations,
        ...aboutField.deprecations,
        ...messageForFansField.deprecations,
        ...requestedPlanTypeField.deprecations,
      ],
    },
  };
};

const validateArtistAccessSubmissionPayload = (payload = {}) => {
  const details = [];
  const add = (field, message) => details.push({ field, message });

  if (!payload.artist_name) add("artist_name", "artist_name is required");
  if (!payload.handle) add("handle", "handle is required");
  if (!payload.email) add("email", "email is required");
  if (!payload.phone) add("phone", "phone is required");
  if (!payload.requested_plan_type) add("requested_plan_type", "requested_plan_type is required");
  if (payload.has_payment_fields) {
    add("payment", "payment_mode and transaction_id are not accepted at submission stage");
  }
  if (payload.artist_name && payload.artist_name.length < 2) {
    add("artist_name", "artist_name must be at least 2 characters");
  }
  if (payload.artist_name.length > LIMITS.artistName) {
    add("artist_name", `artist_name max length is ${LIMITS.artistName}`);
  }
  if (payload.handle && !HANDLE_RE.test(payload.handle)) {
    add("handle", "handle must be slug-like");
  }
  if (payload.handle.length > LIMITS.handle) {
    add("handle", `handle max length is ${LIMITS.handle}`);
  }
  if (payload.email && !EMAIL_RE.test(payload.email)) {
    add("email", "email must be valid");
  }
  if (payload.email.length > LIMITS.email) {
    add("email", `email max length is ${LIMITS.email}`);
  }
  if (payload.phone && payload.phone.length < 7) {
    add("phone", "phone must have at least 7 digits");
  }
  if (payload.phone.length > LIMITS.phone) {
    add("phone", `phone max length is ${LIMITS.phone}`);
  }
  if (payload.about.length > LIMITS.about) {
    add("about", `about max length is ${LIMITS.about}`);
  }
  if (payload.message_for_fans.length > LIMITS.messageForFans) {
    add("message_for_fans", `message_for_fans max length is ${LIMITS.messageForFans}`);
  }
  if (
    payload.requested_plan_type &&
    !PLAN_TYPE_VALUES.includes(normalizePlan(payload.requested_plan_type))
  ) {
    add("requested_plan_type", `requested_plan_type must be one of: ${PLAN_TYPE_VALUES.join(", ")}`);
  }

  if (details.length) {
    throw createContractError({
      code: "validation",
      message: "Invalid artist access request payload",
      details,
    });
  }
  return payload;
};

const normalizeAdminArtistAccessApprovalPayload = (input = {}) => {
  const finalPlanTypeField = resolveAliasedField({
    input,
    canonicalKey: "final_plan_type",
    aliases: [{ key: "finalPlanType" }],
    normalize: normalizePlan,
  });
  const paymentModeField = resolveAliasedField({
    input,
    canonicalKey: "payment_mode",
    aliases: [{ key: "paymentMode" }],
    normalize: (value) => trim(value).toLowerCase(),
  });
  const transactionIdField = resolveAliasedField({
    input,
    canonicalKey: "transaction_id",
    aliases: [{ key: "transactionId" }],
    normalize: trim,
  });
  const passwordField = resolveAliasedField({
    input,
    canonicalKey: "password",
    aliases: [],
    normalize: trim,
  });

  return {
    dto: {
      final_plan_type: finalPlanTypeField.value || "",
      payment_mode: paymentModeField.value || "",
      transaction_id: transactionIdField.value || "",
      password: passwordField.value || "",
    },
    meta: {
      legacyKeys: [
        ...finalPlanTypeField.legacyKeys,
        ...paymentModeField.legacyKeys,
        ...transactionIdField.legacyKeys,
        ...passwordField.legacyKeys,
      ],
      deprecations: [
        ...finalPlanTypeField.deprecations,
        ...paymentModeField.deprecations,
        ...transactionIdField.deprecations,
        ...passwordField.deprecations,
      ],
    },
  };
};

const validateAdminArtistAccessApprovalPayload = (payload = {}) => {
  if (!PLAN_TYPE_VALUES.includes(payload.final_plan_type)) {
    throw createContractError({
      message: `final_plan_type must be one of: ${PLAN_TYPE_VALUES.join(", ")}`,
    });
  }
  if (!payload.password) {
    throw createContractError({ message: "password is required for approval" });
  }
  if (payload.final_plan_type !== "basic" && (!payload.payment_mode || !payload.transaction_id)) {
    throw createContractError({ message: "payment_mode and transaction_id are required" });
  }
  return payload;
};

const normalizeAdminArtistAccessRejectionPayload = (input = {}) => {
  const commentField = resolveAliasedField({
    input,
    canonicalKey: "comment",
    aliases: [],
    normalize: trim,
  });

  return {
    dto: {
      comment: commentField.value || "",
    },
    meta: {
      legacyKeys: [...commentField.legacyKeys],
      deprecations: [...commentField.deprecations],
    },
  };
};

const validateAdminArtistAccessRejectionPayload = (payload = {}) => {
  if (!payload.comment) {
    throw createContractError({ message: "Rejection comment is required" });
  }
  return payload;
};

const normalizeAdminArtistAccessListQuery = (input = {}) => ({
  dto: {
    status: trim(input.status).toLowerCase() || "pending",
    page: input.page,
    pageSize: input.pageSize,
  },
  meta: {
    legacyKeys: [],
  },
});

module.exports = {
  normalizeArtistAccessCheckQuery,
  validateArtistAccessCheckQuery,
  normalizeArtistAccessSubmissionPayload,
  validateArtistAccessSubmissionPayload,
  normalizeAdminArtistAccessApprovalPayload,
  validateAdminArtistAccessApprovalPayload,
  normalizeAdminArtistAccessRejectionPayload,
  validateAdminArtistAccessRejectionPayload,
  normalizeAdminArtistAccessListQuery,
};
