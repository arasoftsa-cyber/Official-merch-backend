"use strict";

const { buildEmailLayout } = require("./layout.template");
const { toText, toUrl, formatDate } = require("./template.helpers");

const buildArtistAccessRequestReceivedEmail = ({
  applicantName,
  requestReference,
  submittedAt,
  reviewStatus,
  dashboardUrl,
} = {}) => {
  const safeName = toText(applicantName);
  const safeRequestReference = toText(requestReference);
  const safeSubmittedAt = formatDate(submittedAt);
  const safeReviewStatus = toText(reviewStatus, "pending");
  const safeDashboardUrl = toUrl(dashboardUrl);

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines: [
      "We received your artist access request.",
      safeRequestReference ? `Reference: ${safeRequestReference}` : "",
      safeSubmittedAt ? `Submitted: ${safeSubmittedAt}` : "",
      `Current status: ${safeReviewStatus}`,
      "We will notify you once review is complete.",
    ],
    ctaLabel: safeDashboardUrl ? "View request status" : "",
    ctaUrl: safeDashboardUrl,
  });

  return {
    subject: "We received your OfficialMerch artist access request",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildArtistAccessRequestReceivedEmail,
};

