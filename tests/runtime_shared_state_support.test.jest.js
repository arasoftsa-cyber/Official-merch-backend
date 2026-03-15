"use strict";

const {
  getTrustBoundaryRuntimeSupport,
  getProcessLocalTrustBoundaryControl,
} = require("../src/core/runtime/trustBoundarySupport");

describe("runtime shared-state support", () => {
  it("identifies local-only trust-boundary controls explicitly in single-instance mode", () => {
    const support = getTrustBoundaryRuntimeSupport({ INSTANCE_MODE: "single" });

    expect(support.instanceMode).toBe("single");
    expect(support.sharedStateReady).toBe(false);
    expect(support.controls.map((control) => control.id)).toEqual([
      "oidc_exchange_codes",
      "rate_limits",
      "account_lockout",
      "order_spam_guard",
    ]);
    expect(support.warnings).toEqual([
      expect.objectContaining({
        event: "process_local_trust_boundary_controls",
        instanceMode: "single",
      }),
    ]);
  });

  it("does not silently treat multi-instance mode as supported", () => {
    const support = getTrustBoundaryRuntimeSupport({ INSTANCE_MODE: "multi" });

    expect(support.sharedStateReady).toBe(false);
    expect(support.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("INSTANCE_MODE=multi is not supported"),
      ])
    );
  });

  it("exposes stable metadata for each process-local control", () => {
    expect(getProcessLocalTrustBoundaryControl("oidc_exchange_codes")).toEqual(
      expect.objectContaining({
        id: "oidc_exchange_codes",
        module: "src/services/oidc.service.js",
      })
    );
    expect(getProcessLocalTrustBoundaryControl("rate_limits")).toEqual(
      expect.objectContaining({
        id: "rate_limits",
        module: "src/core/http/rateLimit.js",
      })
    );
  });
});
