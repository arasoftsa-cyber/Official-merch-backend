"use strict";

const { buildOrderEmail } = require("./order.template.shared");

const buildOrderStatusShippedEmail = (payload = {}) =>
  buildOrderEmail({
    payload: {
      ...payload,
      orderStatus: "shipped",
    },
    statusLabel: "Shipped",
    subjectPrefix: "Order shipped",
    introLines: ["Good news. Your order is on the way."],
    followUpLines: ["Use your tracking details for the latest shipment updates."],
    ctaLabel: "Track your order",
    includeTracking: true,
  });

module.exports = {
  buildOrderStatusShippedEmail,
};

