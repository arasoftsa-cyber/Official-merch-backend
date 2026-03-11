"use strict";

const toText = (value, fallback = "") => {
  const text = String(value == null ? "" : value).trim();
  return text || String(fallback || "");
};

const toLowerText = (value, fallback = "") => toText(value, fallback).toLowerCase();

const toUrl = (value) => {
  const text = toText(value);
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) return "";
  return text;
};

const firstText = (...values) => {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return "";
};

const compactLines = (lines) =>
  (Array.isArray(lines) ? lines : [])
    .map((line) => toText(line))
    .filter(Boolean);

const asFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asNonNegativeNumber = (value) => {
  const parsed = asFiniteNumber(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
};

const formatMoneyFromCents = (amountCents, currency = "INR") => {
  const amount = asFiniteNumber(amountCents);
  if (amount === null) return "";
  const safeCurrency = toText(currency, "INR").toUpperCase();
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  } catch (_err) {
    return `${(amount / 100).toFixed(2)} ${safeCurrency}`;
  }
};

const formatDate = (value) => {
  const text = toText(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const toTitleCase = (value, fallback = "") => {
  const text = toText(value, fallback).toLowerCase();
  if (!text) return "";
  return text
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatAddress = (value) => {
  if (!value) return "";
  if (typeof value === "string") {
    return toText(value);
  }
  if (typeof value !== "object") return "";

  const orderedKeys = [
    "name",
    "line1",
    "line2",
    "city",
    "state",
    "postalCode",
    "zip",
    "country",
    "phone",
  ];
  const parts = orderedKeys
    .map((key) => toText(value[key]))
    .filter(Boolean);
  return parts.join(", ");
};

const formatOrderItemLine = (item = {}, currency = "INR") => {
  const title = firstText(item.title, item.name, item.productName, item.productTitle, "Item");
  const variant = firstText(
    item.variant,
    item.variantName,
    [toText(item.size), toText(item.color)].filter(Boolean).join("/"),
    item.sku
  );
  const quantity = asFiniteNumber(item.qty ?? item.quantity);
  const price = formatMoneyFromCents(item.priceCents ?? item.unitPriceCents ?? item.price, currency);

  const parts = [title];
  if (variant) parts.push(`(${variant})`);
  if (quantity !== null) parts.push(`x${quantity}`);
  if (price) parts.push(`- ${price}`);
  return parts.join(" ").trim();
};

module.exports = {
  toText,
  toLowerText,
  toUrl,
  firstText,
  compactLines,
  asFiniteNumber,
  asNonNegativeNumber,
  formatMoneyFromCents,
  formatDate,
  toTitleCase,
  formatAddress,
  formatOrderItemLine,
};

