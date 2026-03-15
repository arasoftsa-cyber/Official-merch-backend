const failedAttempts = new Map();
const {
  getProcessLocalTrustBoundaryControl,
} = require("../runtime/trustBoundarySupport");
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const ACCOUNT_LOCKOUT_CONTROL = getProcessLocalTrustBoundaryControl("account_lockout");

const isLockedOut = (key) => {
  if (!key) return false;
  const entry = failedAttempts.get(key);
  if (!entry?.lockoutUntil) return false;

  const now = Date.now();
  if (entry.lockoutUntil <= now) {
    failedAttempts.delete(key);
    return false;
  }

  return true;
};

const getRemainingLockoutTime = (key) => {
  if (!key) return 0;
  const entry = failedAttempts.get(key);
  if (!entry?.lockoutUntil) return 0;
  return Math.max(0, entry.lockoutUntil - Date.now());
};

const recordFailedAttempt = (key) => {
  if (!key) {
    return { attempts: 0, remainingAttempts: LOCKOUT_THRESHOLD, lockedOut: false };
  }

  const now = Date.now();
  const existing = failedAttempts.get(key);

  if (existing?.lockoutUntil && existing.lockoutUntil > now) {
    return { attempts: existing.attempts, remainingAttempts: 0, lockedOut: true };
  }

  const attempts = (existing?.attempts || 0) + 1;
  if (attempts >= LOCKOUT_THRESHOLD) {
    failedAttempts.set(key, { attempts, lockoutUntil: now + LOCKOUT_DURATION_MS });
    return { attempts, remainingAttempts: 0, lockedOut: true };
  }

  failedAttempts.set(key, { attempts, lockoutUntil: null });
  return {
    attempts,
    remainingAttempts: Math.max(0, LOCKOUT_THRESHOLD - attempts),
    lockedOut: false,
  };
};

const clearFailedAttempts = (key) => {
  if (!key) return;
  failedAttempts.delete(key);
};

module.exports = {
  ACCOUNT_LOCKOUT_CONTROL,
  failedAttempts,
  LOCKOUT_THRESHOLD,
  LOCKOUT_DURATION_MS,
  isLockedOut,
  recordFailedAttempt,
  clearFailedAttempts,
  getRemainingLockoutTime,
};
