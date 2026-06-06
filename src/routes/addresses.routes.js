"use strict";

const express = require("express");
const { randomUUID } = require("crypto");
const { getDb } = require("../core/db/db");
const { requireAuth } = require("../core/http/auth.middleware");
const { ok, fail } = require("../core/http/errorResponse");

const router = express.Router();

const FORBIDDEN = "forbidden";
const VALIDATION_ERROR = "validation_error";
const ADDRESS_NOT_FOUND = "address_not_found";

const BUYER_ROLES = new Set(["buyer", "fan", "artist", "label", "admin"]);
const ADDRESS_TYPES = new Set(["home", "work", "other"]);

const getRole = (user) =>
  user ? String(user.role || user.userRole || "").trim().toLowerCase() : "";

const isBuyer = (user) => BUYER_ROLES.has(getRole(user));

const rejectIfNotBuyer = (req, res) => {
  if (!isBuyer(req.user)) {
    fail(res, 403, FORBIDDEN, "Forbidden");
    return false;
  }
  return true;
};

const requireBuyer = (req, res, next) => {
  if (rejectIfNotBuyer(req, res)) next();
};

const normalizeText = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const normalizeOptionalText = (value) => {
  const normalized = normalizeText(value);
  return normalized === null ? null : normalized;
};

const parseOptionalBoolean = (value) => {
  if (value === undefined) return undefined;
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
};

const normalizeAddressType = (value) => {
  const normalized = String(value || "home").trim().toLowerCase();
  return ADDRESS_TYPES.has(normalized) ? normalized : null;
};

const validateAddressPayload = (payload, { partial = false } = {}) => {
  const errors = [];
  const normalized = {};

  const requiredFields = [
    ["fullName", "full_name"],
    ["phone", "phone"],
    ["line1", "line1"],
    ["city", "city"],
    ["state", "state"],
    ["postalCode", "postal_code"],
    ["country", "country"],
  ];

  for (const [inputKey, outputKey] of requiredFields) {
    const hasField = Object.prototype.hasOwnProperty.call(payload || {}, inputKey);
    if (!partial || hasField) {
      const value = normalizeText(payload?.[inputKey]);
      if (!value) {
        errors.push({ field: inputKey, message: `${inputKey} is required` });
      } else {
        normalized[outputKey] = value;
      }
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload || {}, "line2")) {
    normalized.line2 = normalizeOptionalText(payload?.line2);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload || {}, "landmark")) {
    normalized.landmark = normalizeOptionalText(payload?.landmark);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload || {}, "addressType")) {
    const addressType = normalizeAddressType(payload?.addressType);
    if (!addressType) {
      errors.push({ field: "addressType", message: "addressType must be one of home, work, other" });
    } else {
      normalized.address_type = addressType;
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload || {}, "isDefault")) {
    const isDefault = parseOptionalBoolean(payload?.isDefault);
    if (isDefault === null) {
      errors.push({ field: "isDefault", message: "isDefault must be a boolean" });
    } else if (isDefault !== undefined) {
      normalized.is_default = isDefault;
    }
  }

  return { errors, value: normalized };
};

const serializeAddress = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    addressType: row.address_type,
    fullName: row.full_name,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2 || null,
    landmark: row.landmark || null,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const listAddressesForUser = async (db, userId) => {
  const rows = await db("user_addresses")
    .where({ user_id: userId })
    .orderBy("is_default", "desc")
    .orderBy("updated_at", "desc");
  return rows.map(serializeAddress);
};

const clearDefaultAddress = async (db, userId, excludeAddressId = null) => {
  let query = db("user_addresses").where({ user_id: userId, is_default: true });
  if (excludeAddressId) {
    query = query.where((builder) => builder.whereNot({ id: excludeAddressId }));
  }
  await query.update({ is_default: false, updated_at: db.fn.now() });
};

const ensureDefaultAddress = async (db, userId) => {
  const existingDefault = await db("user_addresses")
    .where({ user_id: userId, is_default: true })
    .first();
  if (existingDefault) return;

  const fallback = await db("user_addresses")
    .where({ user_id: userId })
    .orderBy("created_at", "asc")
    .first();
  if (!fallback) return;

  await db("user_addresses")
    .where({ id: fallback.id })
    .update({ is_default: true, updated_at: db.fn.now() });
};

router.get("/", requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const db = getDb();
    const addresses = await listAddressesForUser(db, req.user.id);
    return ok(res, { addresses });
  } catch (err) {
    return next(err);
  }
});

router.post("/", requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const { errors, value } = validateAddressPayload(req.body, { partial: false });
    if (errors.length) {
      return fail(res, 400, VALIDATION_ERROR, "Invalid address payload", { details: errors });
    }

    const db = getDb();
    const existingDefault = await db("user_addresses")
      .where({ user_id: req.user.id, is_default: true })
      .first("id");
    const shouldBeDefault = value.is_default === true || !existingDefault;

    if (shouldBeDefault) {
      await clearDefaultAddress(db, req.user.id);
    }

    const now = db.fn.now();
    await db("user_addresses").insert({
      id: randomUUID(),
      user_id: req.user.id,
      address_type: value.address_type || "home",
      full_name: value.full_name,
      phone: value.phone,
      line1: value.line1,
      line2: value.line2 || null,
      landmark: value.landmark || null,
      city: value.city,
      state: value.state,
      postal_code: value.postal_code,
      country: value.country,
      is_default: shouldBeDefault,
      created_at: now,
      updated_at: now,
    });

    const addresses = await listAddressesForUser(db, req.user.id);
    return ok(res, { addresses });
  } catch (err) {
    return next(err);
  }
});

router.patch("/:addressId", requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const { errors, value } = validateAddressPayload(req.body, { partial: true });
    if (errors.length) {
      return fail(res, 400, VALIDATION_ERROR, "Invalid address payload", { details: errors });
    }
    if (!Object.keys(value).length) {
      return fail(res, 400, VALIDATION_ERROR, "At least one address field is required");
    }

    const db = getDb();
    const address = await db("user_addresses")
      .where({ id: req.params.addressId, user_id: req.user.id })
      .first();
    if (!address) {
      return fail(res, 404, ADDRESS_NOT_FOUND, "Address not found");
    }

    if (value.is_default === true) {
      await clearDefaultAddress(db, req.user.id, address.id);
    }

    const nextPatch = {
      ...value,
      updated_at: db.fn.now(),
    };

    await db("user_addresses")
      .where({ id: address.id, user_id: req.user.id })
      .update(nextPatch);

    await ensureDefaultAddress(db, req.user.id);
    const addresses = await listAddressesForUser(db, req.user.id);
    return ok(res, { addresses });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:addressId", requireAuth, requireBuyer, async (req, res, next) => {
  try {
    const db = getDb();
    const address = await db("user_addresses")
      .where({ id: req.params.addressId, user_id: req.user.id })
      .first();
    if (!address) {
      return fail(res, 404, ADDRESS_NOT_FOUND, "Address not found");
    }

    await db("user_addresses")
      .where({ id: address.id, user_id: req.user.id })
      .del();

    await ensureDefaultAddress(db, req.user.id);
    const addresses = await listAddressesForUser(db, req.user.id);
    return ok(res, { addresses });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.__test = {
  isBuyer,
  validateAddressPayload,
  serializeAddress,
};
