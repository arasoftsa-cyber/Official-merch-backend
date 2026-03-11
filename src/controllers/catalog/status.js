const PRODUCT_STATUS_PENDING = "pending";
const PRODUCT_STATUS_INACTIVE = "inactive";
const PRODUCT_STATUS_ACTIVE = "active";
const PRODUCT_STATUS_REJECTED = "rejected";

const PRODUCT_STATUS_VALUES = new Set([
  PRODUCT_STATUS_PENDING,
  PRODUCT_STATUS_INACTIVE,
  PRODUCT_STATUS_ACTIVE,
  PRODUCT_STATUS_REJECTED,
]);

const normalizeProductStatusValue = (rawValue) => {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.trim().toLowerCase();
  if (!PRODUCT_STATUS_VALUES.has(normalized)) return null;
  return normalized;
};

const statusFromIsActive = (isActive) =>
  isActive ? PRODUCT_STATUS_ACTIVE : PRODUCT_STATUS_INACTIVE;

const normalizeProductStatusFromRecord = (product = {}) => {
  const statusFromColumn = normalizeProductStatusValue(product?.status);
  if (statusFromColumn) return statusFromColumn;
  if (product?.is_active === false || product?.isActive === false) {
    return PRODUCT_STATUS_INACTIVE;
  }
  return PRODUCT_STATUS_ACTIVE;
};

const canArtistToggleProductStatus = (existingStatus, requestedStatus = null) => {
  const existingAllowed =
    existingStatus === PRODUCT_STATUS_ACTIVE || existingStatus === PRODUCT_STATUS_INACTIVE;
  if (!existingAllowed) return false;
  if (!requestedStatus) return true;
  return (
    requestedStatus === PRODUCT_STATUS_ACTIVE ||
    requestedStatus === PRODUCT_STATUS_INACTIVE
  );
};

const canAdminPatchProductStatus = (existingStatus, requestedStatus = null) => {
  const existingAllowed =
    existingStatus === PRODUCT_STATUS_ACTIVE || existingStatus === PRODUCT_STATUS_INACTIVE;
  if (!existingAllowed) return false;
  if (!requestedStatus) return true;
  return (
    requestedStatus === PRODUCT_STATUS_ACTIVE ||
    requestedStatus === PRODUCT_STATUS_INACTIVE
  );
};

const withStatus = (product = {}) => ({
  ...product,
  status: normalizeProductStatusFromRecord(product),
});

module.exports = {
  PRODUCT_STATUS_PENDING,
  PRODUCT_STATUS_INACTIVE,
  PRODUCT_STATUS_ACTIVE,
  PRODUCT_STATUS_REJECTED,
  normalizeProductStatusValue,
  statusFromIsActive,
  normalizeProductStatusFromRecord,
  canArtistToggleProductStatus,
  canAdminPatchProductStatus,
  withStatus,
};
