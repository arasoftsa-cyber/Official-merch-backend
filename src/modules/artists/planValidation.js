const { PLAN_TYPES, assertPlanAllowed } = require("./planTypes");

const ADVANCED_PAYMENT_MODES = new Set(["cash", "online"]);

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const createValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  err.code = "validation_error";
  return err;
};

const normalizePaymentMode = (value) => trim(value).toLowerCase();

const validateApprovalPayload = (payload = {}) => {
  const finalPlanTypeInput = payload.final_plan_type ?? payload.finalPlanType;
  if (!trim(finalPlanTypeInput)) {
    throw createValidationError("final_plan_type is required");
  }

  const finalPlanType = assertPlanAllowed(finalPlanTypeInput, {
    fieldName: "final_plan_type",
  });

  if (finalPlanType === PLAN_TYPES.BASIC) {
    return {
      final_plan_type: finalPlanType,
      payment_mode: "NA",
      transaction_id: "NA",
    };
  }

  const paymentMode = normalizePaymentMode(
    payload.payment_mode ?? payload.paymentMode
  );
  const transactionId = trim(payload.transaction_id ?? payload.transactionId);

  if (finalPlanType === PLAN_TYPES.ADVANCED) {
    if (!ADVANCED_PAYMENT_MODES.has(paymentMode)) {
      throw createValidationError(
        "payment_mode must be one of: cash, online when final_plan_type=advanced"
      );
    }
    if (!transactionId) {
      throw createValidationError(
        "transaction_id is required when final_plan_type=advanced"
      );
    }
  }

  return {
    final_plan_type: finalPlanType,
    payment_mode: paymentMode || "NA",
    transaction_id: transactionId || "NA",
  };
};

module.exports = {
  validateApprovalPayload,
};
