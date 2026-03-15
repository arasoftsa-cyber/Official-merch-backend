"use strict";

describe("trust-boundary module metadata", () => {
  it("marks oidc exchange codes as process-local runtime state", () => {
    const oidcService = require("../src/services/oidc.service");

    expect(oidcService.OIDC_EXCHANGE_CODE_CONTROL).toEqual(
      expect.objectContaining({
        id: "oidc_exchange_codes",
        module: "src/services/oidc.service.js",
      })
    );
  });

  it("marks limiter, lockout, and spam controls as process-local runtime state", () => {
    const rateLimit = require("../src/core/http/rateLimit");
    const accountLockout = require("../src/core/http/accountLockout");
    const spamDetection = require("../src/core/http/spamDetection");

    expect(rateLimit.RATE_LIMIT_CONTROL).toEqual(
      expect.objectContaining({
        id: "rate_limits",
        module: "src/core/http/rateLimit.js",
      })
    );
    expect(accountLockout.ACCOUNT_LOCKOUT_CONTROL).toEqual(
      expect.objectContaining({
        id: "account_lockout",
        module: "src/core/http/accountLockout.js",
      })
    );
    expect(spamDetection.ORDER_SPAM_GUARD_CONTROL).toEqual(
      expect.objectContaining({
        id: "order_spam_guard",
        module: "src/core/http/spamDetection.js",
      })
    );
  });
});
