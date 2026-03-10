"use strict";

const { buildEmailLayout } = require("./layout.template");
const { toText, toUrl, firstText, formatDate, toTitleCase } = require("./template.helpers");

const buildAdminNotifyNewArtistAccessRequestEmail = ({
  applicantName,
  artistName,
  labelName,
  requestReference,
  submittedAt,
  requesterEmail,
  requestedPlanType,
  reviewUrl,
  adminDashboardUrl,
} = {}) => {
  const safeApplicantName = firstText(applicantName, artistName);
  const safeLabelName = toText(labelName);
  const safeReference = toText(requestReference);
  const safeSubmittedAt = formatDate(submittedAt);
  const safeRequesterEmail = toText(requesterEmail);
  const safePlanType = toTitleCase(requestedPlanType);
  const safeCtaUrl = firstText(toUrl(reviewUrl), toUrl(adminDashboardUrl));

  const content = buildEmailLayout({
    greeting: "Hello team,",
    lines: [
      "A new artist access request has been submitted.",
      safeApplicantName ? `Applicant: ${safeApplicantName}` : "",
      safeLabelName ? `Label: ${safeLabelName}` : "",
      safeRequesterEmail ? `Email: ${safeRequesterEmail}` : "",
      safePlanType ? `Requested plan: ${safePlanType}` : "",
      safeReference ? `Reference: ${safeReference}` : "",
      safeSubmittedAt ? `Submitted: ${safeSubmittedAt}` : "",
      "Please review this request in the admin portal.",
    ],
    ctaLabel: safeCtaUrl ? "Review request" : "",
    ctaUrl: safeCtaUrl,
  });

  return {
    subject: safeReference
      ? `New artist access request (${safeReference})`
      : "New artist access request submitted",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildAdminNotifyNewArtistAccessRequestEmail,
};
