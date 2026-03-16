"use strict";

const INSTANCE_MODE_SINGLE = "single";
const INSTANCE_MODE_MULTI = "multi";
const DECLARED_INSTANCE_MODES = new Set([INSTANCE_MODE_SINGLE, INSTANCE_MODE_MULTI]);
const TRUST_BOUNDARY_COORDINATION_MODE_PROCESS_LOCAL = "process-local-memory";

const PROCESS_LOCAL_TRUST_BOUNDARY_CONTROLS = Object.freeze({
  oidc_exchange_codes: Object.freeze({
    id: "oidc_exchange_codes",
    module: "src/services/oidc.service.js",
    label: "OIDC exchange code replay/consume state",
    coordinationMode: TRUST_BOUNDARY_COORDINATION_MODE_PROCESS_LOCAL,
  }),
  rate_limits: Object.freeze({
    id: "rate_limits",
    module: "src/core/http/rateLimit.js",
    label: "HTTP rate-limit buckets",
    coordinationMode: TRUST_BOUNDARY_COORDINATION_MODE_PROCESS_LOCAL,
  }),
  account_lockout: Object.freeze({
    id: "account_lockout",
    module: "src/core/http/accountLockout.js",
    label: "account lockout counters",
    coordinationMode: TRUST_BOUNDARY_COORDINATION_MODE_PROCESS_LOCAL,
  }),
  order_spam_guard: Object.freeze({
    id: "order_spam_guard",
    module: "src/core/http/spamDetection.js",
    label: "order spam detection buckets",
    coordinationMode: TRUST_BOUNDARY_COORDINATION_MODE_PROCESS_LOCAL,
  }),
});

const DEFAULT_PROCESS_LOCAL_CONTROL_IDS = Object.freeze(
  Object.keys(PROCESS_LOCAL_TRUST_BOUNDARY_CONTROLS)
);

const normalizeInstanceMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return INSTANCE_MODE_SINGLE;
  if (DECLARED_INSTANCE_MODES.has(normalized)) return normalized;
  return "";
};

const getProcessLocalTrustBoundaryControl = (id) =>
  PROCESS_LOCAL_TRUST_BOUNDARY_CONTROLS[String(id || "").trim()] || null;

const getProcessLocalTrustBoundaryControls = (controlIds = DEFAULT_PROCESS_LOCAL_CONTROL_IDS) =>
  (Array.isArray(controlIds) ? controlIds : DEFAULT_PROCESS_LOCAL_CONTROL_IDS)
    .map((id) => getProcessLocalTrustBoundaryControl(id))
    .filter(Boolean);

const buildMultiInstanceBlockedMessage = (controls = []) => {
  const controlLabels = controls.map((control) => control.label).filter(Boolean);
  const suffix = controlLabels.length > 0 ? `: ${controlLabels.join(", ")}` : "";
  return `[trust-boundary] INSTANCE_MODE=multi is blocked. This backend only supports INSTANCE_MODE=single while these controls remain ${TRUST_BOUNDARY_COORDINATION_MODE_PROCESS_LOCAL}${suffix}. Set INSTANCE_MODE=single or unset INSTANCE_MODE.`;
};

const getTrustBoundaryRuntimeSupport = (env = process.env, controlIds) => {
  const rawInstanceMode = String(env.INSTANCE_MODE || "").trim().toLowerCase();
  const instanceMode = normalizeInstanceMode(rawInstanceMode);
  const controls = getProcessLocalTrustBoundaryControls(controlIds);
  const errors = [];
  const warnings = [];
  const sharedStoreAdapter = null;
  const supportsMultiInstance = false;

  if (!instanceMode) {
    errors.push('INSTANCE_MODE must be "single" or "multi" when set.');
  }

  if (instanceMode === INSTANCE_MODE_MULTI) {
    errors.push(buildMultiInstanceBlockedMessage(controls));
  }

  if (instanceMode === INSTANCE_MODE_SINGLE) {
    warnings.push({
      event: "process_local_trust_boundary_controls",
      instanceMode,
      sharedStateReady: false,
      coordinationMode: TRUST_BOUNDARY_COORDINATION_MODE_PROCESS_LOCAL,
      supportsMultiInstance,
      controls: controls.map((control) => ({
        id: control.id,
        label: control.label,
        module: control.module,
        coordinationMode: control.coordinationMode,
      })),
    });
  }

  return {
    instanceMode: instanceMode || rawInstanceMode,
    requestedInstanceMode: rawInstanceMode || INSTANCE_MODE_SINGLE,
    sharedStateReady: false,
    coordinationMode: TRUST_BOUNDARY_COORDINATION_MODE_PROCESS_LOCAL,
    sharedStoreAdapter,
    supportsMultiInstance,
    controls,
    errors,
    warnings,
  };
};

module.exports = {
  INSTANCE_MODE_SINGLE,
  INSTANCE_MODE_MULTI,
  TRUST_BOUNDARY_COORDINATION_MODE_PROCESS_LOCAL,
  normalizeInstanceMode,
  getProcessLocalTrustBoundaryControl,
  getProcessLocalTrustBoundaryControls,
  buildMultiInstanceBlockedMessage,
  getTrustBoundaryRuntimeSupport,
};
