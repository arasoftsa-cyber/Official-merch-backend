"use strict";

const { buildOrderEmail } = require("./order.template.shared");

const buildOrderStatusProcessingEmail = (payload = {}) =>
  buildOrderEmail({
    payload: {
      ...payload,
      orderStatus: "processing",
    },
    statusLabel: "Processing",
    subjectPrefix: "Order update",
    introLines: [
      "Your order is now being processed.",
      "We are preparing your items for dispatch.",
    ],
    followUpLines: ["You will receive another email once your shipment is dispatched."],
  });

module.exports = {
  buildOrderStatusProcessingEmail,
};

