"use strict";

const { buildEmailLayout } = require("./layout.template");

const buildWelcomeAccountEmail = ({ appUrl, loginUrl } = {}) => {
  const safeLoginUrl = String(loginUrl || appUrl || "").trim();
  const content = buildEmailLayout({
    greeting: "Welcome,",
    lines: [
      "Your OfficialMerch account is ready.",
      "You can now sign in to explore merch drops, orders, and your account settings.",
      "If you did not create this account, contact support.",
    ],
    ctaLabel: safeLoginUrl ? "Go to OfficialMerch" : "",
    ctaUrl: safeLoginUrl,
  });

  return {
    subject: "Welcome to OfficialMerch",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildWelcomeAccountEmail,
};

