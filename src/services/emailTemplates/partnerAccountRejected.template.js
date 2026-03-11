"use strict";

const { buildEmailLayout } = require("./layout.template");
const { toText, toUrl, firstText } = require("./template.helpers");

const buildPartnerAccountRejectedEmail = ({
  accountName,
  rejectionReason,
  reason,
  supportUrl,
  appUrl,
} = {}) => {
  const safeName = toText(accountName);
  const safeReason = firstText(rejectionReason, reason);
  const safeCtaUrl = firstText(toUrl(supportUrl), toUrl(appUrl));

  const lines = [
    "Your OfficialMerch partner account request was not approved.",
    safeReason ? `Reason: ${safeReason}` : "",
    "If you need help, contact support or submit a new request.",
  ];

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines,
    ctaLabel: safeCtaUrl ? "Contact support" : "",
    ctaUrl: safeCtaUrl,
  });

  return {
    subject: "Update on your OfficialMerch partner account request",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildPartnerAccountRejectedEmail,
};

