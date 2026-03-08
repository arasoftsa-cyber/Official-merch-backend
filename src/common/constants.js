const PLAN_TYPES = Object.freeze({
    BASIC: "basic",
    ADVANCED: "advanced",
    PREMIUM: "premium",
  });
  
  const PLAN_TYPE_VALUES = Object.freeze([
    PLAN_TYPES.BASIC,
    PLAN_TYPES.ADVANCED,
    PLAN_TYPES.PREMIUM,
  ]);
  
  const DEFAULT_ENABLED_PLAN_TYPES = Object.freeze([
    PLAN_TYPES.BASIC,
    PLAN_TYPES.ADVANCED,
  ]);
  
  const trim = (value) => (typeof value === "string" ? value.trim() : "");
  
  const normalizePlan = (plan) => trim(plan).toLowerCase();
  
  const isPremiumPlanEnabled = () =>
    normalizePlan(process.env.PREMIUM_PLAN_ENABLED) === "true";
  
  const getEnabledPlanTypes = () =>
    isPremiumPlanEnabled() ? PLAN_TYPE_VALUES : DEFAULT_ENABLED_PLAN_TYPES;
  
  const isPlanType = (plan) => PLAN_TYPE_VALUES.includes(normalizePlan(plan));
  
  const isPlanEnabled = (plan) => {
    const normalized = normalizePlan(plan);
    return getEnabledPlanTypes().includes(normalized);
  };
  
  const createValidationError = (message) => {
    const err = new Error(message);
    err.status = 400;
    err.code = "validation_error";
    return err;
  };
  
  const assertPlanAllowed = (plan, options = {}) => {
    const fieldName = options.fieldName || "plan_type";
    const normalized = normalizePlan(plan);
    if (!normalized || !isPlanType(normalized)) {
      throw createValidationError(
        `${fieldName} must be one of: ${PLAN_TYPE_VALUES.join(", ")}`
      );
    }
    if (!isPlanEnabled(normalized)) {
      throw createValidationError(
        `${fieldName} "${normalized}" is not enabled`
      );
    }
    return normalized;
  };

const HOMEPAGE_ENTITY_TYPE = "homepage";
const HOMEPAGE_ENTITY_ID = "00000000-0000-0000-0000-000000000001";
const ROLE_HERO_CAROUSEL = "hero_carousel";
const DEFAULT_HOMEPAGE_BANNER_SORT_ORDER = 100;
  
  module.exports = {
    PLAN_TYPES,
    PLAN_TYPE_VALUES,
    DEFAULT_ENABLED_PLAN_TYPES,
    HOMEPAGE_ENTITY_TYPE,
    HOMEPAGE_ENTITY_ID,
    ROLE_HERO_CAROUSEL,
    DEFAULT_HOMEPAGE_BANNER_SORT_ORDER,
    normalizePlan,
    isPlanEnabled,
    assertPlanAllowed,
  };
  