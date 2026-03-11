"use strict";

const { buildEmailLayout } = require("./layout.template");
const {
  toText,
  toUrl,
  firstText,
  compactLines,
  asNonNegativeNumber,
  formatMoneyFromCents,
  formatDate,
  toTitleCase,
  formatAddress,
  formatOrderItemLine,
} = require("./template.helpers");

const resolveOrderReference = (payload = {}) =>
  firstText(payload.orderNumber, payload.orderId, payload.orderReference);

const resolveCurrency = (payload = {}) => toText(payload.currency, "INR").toUpperCase();

const resolveOrderUrl = (payload = {}) => toUrl(payload.orderUrl);

const buildOrderDetailsLines = (
  payload = {},
  { includeStatus = true, includeTracking = false, includeItems = true } = {}
) => {
  const currency = resolveCurrency(payload);
  const orderRef = resolveOrderReference(payload);
  const orderDate = formatDate(payload.orderDate);
  const orderStatus = includeStatus ? toTitleCase(payload.orderStatus || payload.status) : "";
  const subtotal = formatMoneyFromCents(payload.subtotalCents ?? payload.subtotal, currency);
  const shipping = formatMoneyFromCents(payload.shippingCents ?? payload.shipping, currency);
  const discount = formatMoneyFromCents(payload.discountCents ?? payload.discount, currency);
  const total = formatMoneyFromCents(payload.totalCents ?? payload.total, currency);
  const shippingAddress = formatAddress(payload.shippingAddress);
  const carrier = toText(payload.carrier);
  const trackingNumber = toText(payload.trackingNumber);
  const trackingUrl = toUrl(payload.trackingUrl);

  const lines = [];
  if (orderRef) lines.push(`Order: ${orderRef}`);
  if (orderDate) lines.push(`Date: ${orderDate}`);
  if (orderStatus) lines.push(`Status: ${orderStatus}`);

  const amountLines = compactLines([
    subtotal ? `Subtotal: ${subtotal}` : "",
    shipping ? `Shipping: ${shipping}` : "",
    discount ? `Discount: ${discount}` : "",
    total ? `Total: ${total}` : "",
  ]);
  lines.push(...amountLines);

  if (shippingAddress) {
    lines.push(`Shipping address: ${shippingAddress}`);
  }

  if (includeTracking) {
    if (carrier) lines.push(`Carrier: ${carrier}`);
    if (trackingNumber) lines.push(`Tracking number: ${trackingNumber}`);
    if (trackingUrl) lines.push(`Tracking link: ${trackingUrl}`);
  }

  if (includeItems) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const cappedItems = items.slice(0, 5);
    if (cappedItems.length > 0) {
      lines.push("Items:");
      for (const item of cappedItems) {
        lines.push(`- ${formatOrderItemLine(item, currency)}`);
      }
      if (items.length > cappedItems.length) {
        lines.push(`- +${items.length - cappedItems.length} more item(s)`);
      }
    } else {
      const itemCount = asNonNegativeNumber(payload.itemCount);
      if (itemCount !== null) {
        lines.push(`Items: ${itemCount}`);
      }
    }
  }

  return compactLines(lines);
};

const buildOrderEmail = ({
  payload = {},
  statusLabel = "",
  subjectPrefix = "Order update",
  introLines = [],
  followUpLines = [],
  ctaLabel = "View your order",
  includeTracking = false,
} = {}) => {
  const orderRef = resolveOrderReference(payload);
  const safeStatusLabel = toText(statusLabel) || toTitleCase(payload.orderStatus || payload.status);
  const orderUrl = resolveOrderUrl(payload);

  const content = buildEmailLayout({
    greeting: firstText(payload.customerName, payload.name)
      ? `Hello ${firstText(payload.customerName, payload.name)},`
      : "Hello,",
    lines: compactLines([
      ...introLines,
      ...buildOrderDetailsLines(payload, {
        includeStatus: Boolean(safeStatusLabel),
        includeTracking,
        includeItems: true,
      }),
      ...followUpLines,
    ]),
    ctaLabel: orderUrl ? ctaLabel : "",
    ctaUrl: orderUrl,
  });

  const subjectStatus = safeStatusLabel ? ` - ${safeStatusLabel}` : "";
  const subjectRef = orderRef ? ` (${orderRef})` : "";

  return {
    subject: `${toText(subjectPrefix, "Order update")}${subjectRef}${subjectStatus}`,
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  resolveOrderReference,
  resolveCurrency,
  resolveOrderUrl,
  buildOrderDetailsLines,
  buildOrderEmail,
};

