"use strict";

const { buildEmailLayout } = require("./layout.template");
const { toText, toUrl, asNonNegativeNumber } = require("./template.helpers");

const buildEmailVerificationEmail = ({
  customerName,
  verificationUrl,
  expiresInMinutes,
} = {}) => {
  const safeVerificationUrl = toUrl(verificationUrl);
  const safeMinutes = asNonNegativeNumber(expiresInMinutes);
  const expiryLine = safeMinutes
    ? `This verification link expires in ${safeMinutes} minute(s).`
    : "Use the link below to verify your email address.";

  const content = buildEmailLayout({
    greeting: toText(customerName) ? `Hello ${toText(customerName)},` : "Hello,",
    lines: [
      "Please verify your OfficialMerch email address to secure your account.",
      expiryLine,
      "If you did not request this, you can ignore this email.",
    ],
    ctaLabel: safeVerificationUrl ? "Verify email" : "",
    ctaUrl: safeVerificationUrl,
  });

  return {
    subject: "Verify your OfficialMerch email address",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildEmailVerificationEmail,
};

