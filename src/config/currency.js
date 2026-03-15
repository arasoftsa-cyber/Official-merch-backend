"use strict";

const normalizeCurrency = (currency) => String(currency || "").trim().toUpperCase();

const DEFAULT_CURRENCY = normalizeCurrency(process.env.MERCH_CURRENCY) || "INR";

const getSystemCurrency = () => DEFAULT_CURRENCY;

const assertSupportedCurrency = (currency, options = {}) => {
  const { allowDefaultOnEmpty = false } = options;
  const normalizedCurrency = normalizeCurrency(currency);

  if (!normalizedCurrency) {
    if (allowDefaultOnEmpty) {
      return getSystemCurrency();
    }
    const err = new Error("currency_required");
    err.code = "CURRENCY_REQUIRED";
    throw err;
  }

  if (normalizedCurrency !== getSystemCurrency()) {
    const err = new Error("currency_mismatch");
    err.code = "CURRENCY_MISMATCH";
    err.details = {
      currency: normalizedCurrency,
      expectedCurrency: getSystemCurrency(),
    };
    throw err;
  }

  return normalizedCurrency;
};

module.exports = {
  DEFAULT_CURRENCY,
  getSystemCurrency,
  assertSupportedCurrency,
};
