"use strict";

const { buildOrderEmail } = require("./order.template.shared");

const buildOrderConfirmationEmail = (payload = {}) =>
  buildOrderEmail({
    payload,
    statusLabel: "Confirmed",
    subjectPrefix: "Order confirmation",
    introLines: [
      "Thanks for your order with OfficialMerch.",
      "Your order has been received and is now confirmed.",
    ],
    followUpLines: ["We will email you again when your order status changes."],
    ctaLabel: "View your order",
    includeTracking: false,
  });

module.exports = {
  buildOrderConfirmationEmail,
};
