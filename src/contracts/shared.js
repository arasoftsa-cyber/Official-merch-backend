"use strict";

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((entry) => JSON.parse(stableStringify(entry))));
  }
  if (value && typeof value === "object") {
    const sorted = Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = JSON.parse(stableStringify(value[key]));
        return acc;
      }, {});
    return JSON.stringify(sorted);
  }
  return JSON.stringify(value);
};

const sameValue = (left, right) => stableStringify(left) === stableStringify(right);

const createContractError = ({ code = "validation_error", message, details } = {}) => {
  const err = new Error(message || code);
  err.code = code;
  err.status = 400;
  err.details = Array.isArray(details) ? details : [];
  return err;
};

const normalizeAliasSpec = (alias, canonicalKey) => {
  if (typeof alias === "string") {
    return {
      key: alias,
      canonicalKey,
      removalWindow: "2026-Q3 compatibility cleanup",
    };
  }
  if (alias && typeof alias === "object" && typeof alias.key === "string") {
    return {
      key: alias.key,
      canonicalKey,
      removalWindow: alias.removalWindow || "2026-Q3 compatibility cleanup",
    };
  }
  return null;
};

const resolveAliasedField = ({
  input,
  canonicalKey,
  aliases = [],
  normalize = (value) => value,
}) => {
  const aliasSpecs = aliases
    .map((alias) => normalizeAliasSpec(alias, canonicalKey))
    .filter(Boolean);
  const keys = [canonicalKey, ...aliasSpecs.map((alias) => alias.key)];
  const presentEntries = keys
    .filter((key) => hasOwn(input, key))
    .map((key) => ({
      key,
      value: normalize(input[key]),
    }));

  if (!presentEntries.length) {
    return { value: undefined, legacyKeys: [], deprecations: [] };
  }

  const canonicalEntry = presentEntries.find((entry) => entry.key === canonicalKey) || null;
  if (canonicalEntry) {
    const conflicting = presentEntries.find(
      (entry) => entry.key !== canonicalKey && !sameValue(entry.value, canonicalEntry.value)
    );
    if (conflicting) {
      throw createContractError({
        message: `Conflicting payload fields: '${canonicalKey}' and legacy alias '${conflicting.key}' both provided with different values.`,
        details: [
          {
            field: canonicalKey,
            message: `conflicts with legacy alias '${conflicting.key}'`,
          },
        ],
      });
    }
  }

  const chosen = canonicalEntry || presentEntries[0];
  const legacyKeys = presentEntries
    .filter((entry) => entry.key !== canonicalKey)
    .map((entry) => entry.key);
  return {
    value: chosen?.value,
    legacyKeys,
    deprecations: legacyKeys
      .map((legacyKey) => {
        const aliasSpec = aliasSpecs.find((entry) => entry.key === legacyKey);
        if (!aliasSpec) return null;
        return {
          event: "contract_alias_used",
          canonicalKey,
          aliasKey: legacyKey,
          removalWindow: aliasSpec.removalWindow,
        };
      })
      .filter(Boolean),
  };
};

const logLegacyContractUse = ({ workflow, legacyKeys = [] }) => {
  const uniqueKeys = Array.from(new Set(legacyKeys.filter(Boolean)));
  if (!workflow || !uniqueKeys.length) return;
  console.warn("[contracts]", {
    event: "legacy_contract_key_used",
    workflow,
    legacyKeys: uniqueKeys,
  });
};

module.exports = {
  hasOwn,
  sameValue,
  createContractError,
  resolveAliasedField,
  logLegacyContractUse,
};
