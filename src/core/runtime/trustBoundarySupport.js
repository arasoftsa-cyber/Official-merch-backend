"use strict";

const INSTANCE_MODE_SINGLE = "single";
const INSTANCE_MODE_MULTI = "multi";
const SUPPORTED_INSTANCE_MODES = new Set([INSTANCE_MODE_SINGLE, INSTANCE_MODE_MULTI]);

const PROCESS_LOCAL_TRUST_BOUNDARY_CONTROLS = Object.freeze({
  oidc_exchange_codes: Object.freeze({
    id: "oidc_exchange_codes",
    module: "src/services/oidc.service.js",
    label: "OIDC exchange code replay/consume state",
  }),
  rate_limits: Object.freeze({
    id: "rate_limits",
    module: "src/core/http/rateLimit.js",
    label: "HTTP rate-limit buckets",
  }),
  account_lockout: Object.freeze({
    id: "account_lockout",
    module: "src/core/http/accountLockout.js",
    label: "account lockout counters",
  }),
  order_spam_guard: Object.freeze({
    id: "order_spam_guard",
    module: "src/core/http/spamDetection.js",
    label: "order spam detection buckets",
  }),
});

const DEFAULT_PROCESS_LOCAL_CONTROL_IDS = Object.freeze(
  Object.keys(PROCESS_LOCAL_TRUST_BOUNDARY_CONTROLS)
);

const normalizeInstanceMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return INSTANCE_MODE_SINGLE;
  if (SUPPORTED_INSTANCE_MODES.has(normalized)) return normalized;
  return "";
};

const getProcessLocalTrustBoundaryControl = (id) =>
  PROCESS_LOCAL_TRUST_BOUNDARY_CONTROLS[String(id || "").trim()] || null;

const getProcessLocalTrustBoundaryControls = (controlIds = DEFAULT_PROCESS_LOCAL_CONTROL_IDS) =>
  (Array.isArray(controlIds) ? controlIds : DEFAULT_PROCESS_LOCAL_CONTROL_IDS)
    .map((id) => getProcessLocalTrustBoundaryControl(id))
    .filter(Boolean);

const getTrustBoundaryRuntimeSupport = (env = process.env, controlIds) => {
  const rawInstanceMode = String(env.INSTANCE_MODE || "").trim().toLowerCase();
  const instanceMode = normalizeInstanceMode(rawInstanceMode);
  const controls = getProcessLocalTrustBoundaryControls(controlIds);
  const controlLabels = controls.map((control) => control.label);
  const errors = [];
  const warnings = [];

  if (!instanceMode) {
    errors.push('INSTANCE_MODE must be "single" or "multi" when set.');
  }

  if (instanceMode === INSTANCE_MODE_MULTI) {
    errors.push(
      `[trust-boundary] INSTANCE_MODE=multi is not supported while these controls remain process-local: ${controlLabels.join(", ")}.`
    );
  }

  if (instanceMode === INSTANCE_MODE_SINGLE) {
    warnings.push({
      event: "process_local_trust_boundary_controls",
      instanceMode,
      sharedStateReady: false,
      controls: controls.map((control) => ({
        id: control.id,
        label: control.label,
        module: control.module,
      })),
    });
  }

  return {
    instanceMode: instanceMode || rawInstanceMode,
    sharedStateReady: false,
    controls,
    errors,
    warnings,
  };
};

module.exports = {
  INSTANCE_MODE_SINGLE,
  INSTANCE_MODE_MULTI,
  normalizeInstanceMode,
  getProcessLocalTrustBoundaryControl,
  getProcessLocalTrustBoundaryControls,
  getTrustBoundaryRuntimeSupport,
};
