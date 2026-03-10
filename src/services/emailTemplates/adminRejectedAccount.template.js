"use strict";

const { buildEmailLayout } = require("./layout.template");

const buildAdminRejectedAccountEmail = ({
  accountName,
  reason,
  appUrl,
} = {}) => {
  const safeName = String(accountName || "").trim();
  const safeReason = String(reason || "").trim();
  const safeAppUrl = String(appUrl || "").trim();

  const lines = [
    "Your OfficialMerch account request was not approved.",
    "You can contact support if you need clarification or want to reapply.",
  ];
  if (safeReason) {
    lines.splice(1, 0, `Reason: ${safeReason}`);
  }

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines,
    ctaLabel: safeAppUrl ? "Go to OfficialMerch" : "",
    ctaUrl: safeAppUrl,
  });

  return {
    subject: "Update on your OfficialMerch account request",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildAdminRejectedAccountEmail,
};

