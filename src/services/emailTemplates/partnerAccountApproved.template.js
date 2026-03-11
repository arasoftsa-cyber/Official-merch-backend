"use strict";

const { buildEmailLayout } = require("./layout.template");
const { toText, toUrl, firstText } = require("./template.helpers");

const buildPartnerAccountApprovedEmail = ({
  accountName,
  loginUrl,
  dashboardUrl,
  appUrl,
} = {}) => {
  const safeName = toText(accountName);
  const safeCtaUrl = firstText(toUrl(loginUrl), toUrl(dashboardUrl), toUrl(appUrl));

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines: [
      "Your OfficialMerch partner account has been approved.",
      "You can now sign in and continue onboarding from your partner dashboard.",
    ],
    ctaLabel: safeCtaUrl ? "Open partner portal" : "",
    ctaUrl: safeCtaUrl,
  });

  return {
    subject: "Your OfficialMerch partner account is approved",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildPartnerAccountApprovedEmail,
};

