"use strict";

const { buildOrderEmail } = require("./order.template.shared");

const buildOrderStatusDeliveredEmail = (payload = {}) =>
  buildOrderEmail({
    payload: {
      ...payload,
      orderStatus: "delivered",
    },
    statusLabel: "Delivered",
    subjectPrefix: "Order delivered",
    introLines: ["Your order has been delivered."],
    followUpLines: ["If anything looks wrong, contact support and include your order reference."],
  });

module.exports = {
  buildOrderStatusDeliveredEmail,
};

