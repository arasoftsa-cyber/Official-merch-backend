"use strict";

const { buildEmailLayout } = require("./layout.template");

const buildPasswordResetEmail = ({ resetUrl, expiresInMinutes }) => {
  const safeUrl = String(resetUrl || "").trim();
  const safeMinutes = Number(expiresInMinutes) || 60;

  const content = buildEmailLayout({
    greeting: "Hello,",
    lines: [
      "We received a request to reset your OfficialMerch password.",
      `This link expires in ${safeMinutes} minutes.`,
      "If you did not request this, you can ignore this email.",
    ],
    ctaLabel: "Reset password",
    ctaUrl: safeUrl,
  });

  return {
    subject: "Reset your OfficialMerch password",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildPasswordResetEmail,
};
