"use strict";

const { buildEmailLayout } = require("./layout.template");
const { toText, toUrl, firstText } = require("./template.helpers");

const buildArtistAccessRequestRejectedEmail = ({
  applicantName,
  requestReference,
  rejectionReason,
  reason,
  reapplyUrl,
  supportUrl,
} = {}) => {
  const safeName = toText(applicantName);
  const safeReference = toText(requestReference);
  const safeReason = firstText(rejectionReason, reason);
  const safeCtaUrl = firstText(toUrl(reapplyUrl), toUrl(supportUrl));

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines: [
      "Your artist access request was not approved.",
      safeReference ? `Reference: ${safeReference}` : "",
      safeReason ? `Reason: ${safeReason}` : "",
      "You can update your application and submit a new request.",
    ],
    ctaLabel: safeCtaUrl ? "Review your next steps" : "",
    ctaUrl: safeCtaUrl,
  });

  return {
    subject: "Update on your OfficialMerch artist access request",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildArtistAccessRequestRejectedEmail,
};

