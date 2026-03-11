"use strict";

const { buildEmailLayout } = require("./layout.template");

const buildAdminApprovedAccountEmail = ({
  accountName,
  loginUrl,
  appUrl,
} = {}) => {
  const safeName = String(accountName || "").trim();
  const safeLoginUrl = String(loginUrl || appUrl || "").trim();

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines: [
      "Your OfficialMerch account request has been approved.",
      "You can now sign in and continue setup in the partner portal.",
    ],
    ctaLabel: safeLoginUrl ? "Log in to partner portal" : "",
    ctaUrl: safeLoginUrl,
  });

  return {
    subject: "Your OfficialMerch account is approved",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildAdminApprovedAccountEmail,
};

