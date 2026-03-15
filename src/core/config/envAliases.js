"use strict";

const trim = (value) => String(value || "").trim();
const trimNoTrailingSlash = (value) => trim(value).replace(/\/+$/, "");

const canonicalEnvAliasDefinitions = ({ isProduction, isTest, isCi } = {}) =>
  Object.freeze({
    FRONTEND_ORIGIN: {
      aliases: [
        "PUBLIC_APP_ORIGIN",
        isTest ? "TEST_FRONTEND_ORIGIN" : "",
        isCi ? "CI_FRONTEND_ORIGIN" : "",
        isProduction ? "PROD_FRONTEND_ORIGIN" : "",
        isProduction ? "FRONTEND_ORIGIN_PROD" : "FRONTEND_ORIGIN_DEV",
        "DEV_FRONTEND_ORIGIN",
      ].filter(Boolean),
      normalize: trimNoTrailingSlash,
    },
    BACKEND_BASE_URL: {
      aliases: [
        isTest ? "TEST_BACKEND_BASE_URL" : "",
        isCi ? "CI_BACKEND_BASE_URL" : "",
        isProduction ? "PROD_BACKEND_BASE_URL" : "",
        isProduction ? "BACKEND_BASE_URL_PROD" : "BACKEND_BASE_URL_DEV",
        "DEV_BACKEND_BASE_URL",
        "BACKEND_PUBLIC_URL",
        "BACKEND_URL",
        "PUBLIC_BASE_URL",
      ].filter(Boolean),
      normalize: trimNoTrailingSlash,
    },
    OIDC_APP_BASE_URL: {
      aliases: [
        "APP_PUBLIC_URL",
        "UI_BASE_URL",
        "FRONTEND_URL",
        "CLIENT_URL",
        "PUBLIC_URL",
        "APP_URL",
      ],
      normalize: trimNoTrailingSlash,
    },
    OIDC_APP_CALLBACK_PATH: {
      aliases: ["OIDC_FRONTEND_CALLBACK_PATH"],
      normalize: trim,
    },
    JWT_SECRET: {
      aliases: ["JWT_ACCESS_SECRET"],
      normalize: trim,
      canonicalAliasConflict: "warn",
    },
  });

const formatAliasConflict = (canonicalKey, sourceKeys) =>
  `Conflicting environment values for ${canonicalKey}: ${sourceKeys.join(", ")}`;

const resolveCanonicalEnvValue = (env, canonicalKey, definition = {}) => {
  const normalize = typeof definition.normalize === "function" ? definition.normalize : trim;
  const aliases = Array.isArray(definition.aliases) ? definition.aliases : [];

  const canonicalValue = normalize(env?.[canonicalKey]);
  const aliasEntries = aliases
    .map((aliasKey) => ({
      key: aliasKey,
      value: normalize(env?.[aliasKey]),
    }))
    .filter((entry) => entry.value);

  const errors = [];
  const warnings = [];
  const aliasWarnings = [];
  let value = canonicalValue;
  let sourceKey = canonicalValue ? canonicalKey : "";

  if (canonicalValue) {
    const conflictingAlias = aliasEntries.find((entry) => entry.value !== canonicalValue);
    if (conflictingAlias) {
      if (definition.canonicalAliasConflict === "warn") {
        warnings.push(
          `${conflictingAlias.key} differs from ${canonicalKey}; ${canonicalKey} is authoritative.`
        );
      } else {
        errors.push(formatAliasConflict(canonicalKey, [canonicalKey, conflictingAlias.key]));
      }
    }
    return {
      canonicalKey,
      value,
      sourceKey: sourceKey || canonicalKey,
      errors,
      warnings,
      aliasWarnings,
    };
  }

  if (aliasEntries.length === 0) {
    return {
      canonicalKey,
      value: "",
      sourceKey: "",
      errors,
      warnings,
      aliasWarnings,
    };
  }

  const distinctAliasValues = new Map();
  for (const entry of aliasEntries) {
    if (!distinctAliasValues.has(entry.value)) {
      distinctAliasValues.set(entry.value, []);
    }
    distinctAliasValues.get(entry.value).push(entry.key);
  }

  if (distinctAliasValues.size > 1) {
    errors.push(
      formatAliasConflict(
        canonicalKey,
        aliasEntries.map((entry) => entry.key)
      )
    );
    return {
      canonicalKey,
      value: "",
      sourceKey: "",
      errors,
      warnings,
      aliasWarnings,
    };
  }

  const selected = aliasEntries[0];
  value = selected.value;
  sourceKey = selected.key;
  aliasWarnings.push({
    event: "env_alias_used",
    canonicalKey,
    aliasKey: selected.key,
    message: `Use ${canonicalKey} instead of deprecated alias ${selected.key}.`,
  });

  return {
    canonicalKey,
    value,
    sourceKey,
    errors,
    warnings,
    aliasWarnings,
  };
};

const resolveCanonicalEnvMap = (env, definitions) => {
  const values = {};
  const sources = {};
  const errors = [];
  const warnings = [];
  const aliasWarnings = [];

  for (const [canonicalKey, definition] of Object.entries(definitions || {})) {
    const resolved = resolveCanonicalEnvValue(env, canonicalKey, definition);
    values[canonicalKey] = resolved.value;
    sources[canonicalKey] = resolved.sourceKey;
    errors.push(...resolved.errors);
    warnings.push(...resolved.warnings);
    aliasWarnings.push(...resolved.aliasWarnings);
  }

  return {
    values,
    sources,
    errors,
    warnings,
    aliasWarnings,
  };
};

module.exports = {
  trim,
  trimNoTrailingSlash,
  canonicalEnvAliasDefinitions,
  resolveCanonicalEnvValue,
  resolveCanonicalEnvMap,
};
