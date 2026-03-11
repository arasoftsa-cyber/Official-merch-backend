"use strict";

const { buildOrderEmail } = require("./order.template.shared");

const buildOrderStatusCancelledEmail = (payload = {}) =>
  buildOrderEmail({
    payload: {
      ...payload,
      orderStatus: "cancelled",
    },
    statusLabel: "Cancelled",
    subjectPrefix: "Order cancelled",
    introLines: ["Your order has been cancelled."],
    followUpLines: [
      "If this cancellation was unexpected, contact support for assistance.",
    ],
  });

module.exports = {
  buildOrderStatusCancelledEmail,
};

