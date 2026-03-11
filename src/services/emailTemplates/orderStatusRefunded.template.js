"use strict";

const { buildOrderEmail } = require("./order.template.shared");

const buildOrderStatusRefundedEmail = (payload = {}) =>
  buildOrderEmail({
    payload: {
      ...payload,
      orderStatus: "refunded",
    },
    statusLabel: "Refunded",
    subjectPrefix: "Order refunded",
    introLines: ["A refund has been issued for your order."],
    followUpLines: ["Please allow your payment provider time to process the refund."],
  });

module.exports = {
  buildOrderStatusRefundedEmail,
};

