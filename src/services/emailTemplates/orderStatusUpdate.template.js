"use strict";

const { buildEmailLayout } = require("./layout.template");

const ORDER_STATUS_LABELS = Object.freeze({
  paid: "Confirmed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  processing: "Processing",
  confirmed: "Confirmed",
});

const statusLabel = (status) => {
  const key = String(status || "").trim().toLowerCase();
  return ORDER_STATUS_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Updated");
};

const defaultStatusMessage = (status) => {
  const key = String(status || "").trim().toLowerCase();
  if (key === "paid" || key === "confirmed") {
    return "Your payment has been received and your order is confirmed.";
  }
  if (key === "cancelled") {
    return "Your order has been cancelled.";
  }
  if (key === "refunded") {
    return "A refund has been issued for this order.";
  }
  return "Your order status was updated.";
};

const buildOrderStatusUpdateEmail = ({
  customerName,
  orderId,
  status,
  message,
  orderUrl,
} = {}) => {
  const safeName = String(customerName || "").trim();
  const safeOrderId = String(orderId || "").trim();
  const safeStatus = String(status || "").trim().toLowerCase();
  const safeOrderUrl = String(orderUrl || "").trim();
  const safeMessage = String(message || "").trim() || defaultStatusMessage(safeStatus);

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines: [
      safeOrderId ? `Order reference: ${safeOrderId}` : "",
      `Status: ${statusLabel(safeStatus)}`,
      safeMessage,
    ].filter(Boolean),
    ctaLabel: safeOrderUrl ? "View your order" : "",
    ctaUrl: safeOrderUrl,
  });

  return {
    subject: safeOrderId
      ? `Order update (${safeOrderId}): ${statusLabel(safeStatus)}`
      : `Order update: ${statusLabel(safeStatus)}`,
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildOrderStatusUpdateEmail,
};

