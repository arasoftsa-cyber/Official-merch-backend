"use strict";

const { buildEmailLayout } = require("./layout.template");

const buildShipmentDispatchedEmail = ({
  customerName,
  orderId,
  carrier,
  trackingNumber,
  trackingUrl,
  orderUrl,
} = {}) => {
  const safeName = String(customerName || "").trim();
  const safeOrderId = String(orderId || "").trim();
  const safeCarrier = String(carrier || "").trim();
  const safeTrackingNumber = String(trackingNumber || "").trim();
  const safeTrackingUrl = String(trackingUrl || "").trim();
  const safeOrderUrl = String(orderUrl || "").trim();

  const details = [];
  if (safeOrderId) details.push(`Order reference: ${safeOrderId}`);
  if (safeCarrier) details.push(`Carrier: ${safeCarrier}`);
  if (safeTrackingNumber) details.push(`Tracking number: ${safeTrackingNumber}`);
  if (safeTrackingUrl) details.push(`Tracking link: ${safeTrackingUrl}`);

  const ctaUrl = safeTrackingUrl || safeOrderUrl;
  const ctaLabel = safeTrackingUrl ? "Track shipment" : safeOrderUrl ? "View your order" : "";

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines: [
      "Your order is on the way.",
      ...details,
      "We will notify you again if there are any delivery updates.",
    ],
    ctaLabel,
    ctaUrl,
  });

  return {
    subject: safeOrderId
      ? `Shipment dispatched for order ${safeOrderId}`
      : "Your OfficialMerch order is on the way",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildShipmentDispatchedEmail,
};

