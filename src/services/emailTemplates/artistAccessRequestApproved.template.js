"use strict";

const { buildEmailLayout } = require("./layout.template");
const { toText, toUrl, firstText } = require("./template.helpers");

const buildArtistAccessRequestApprovedEmail = ({
  applicantName,
  artistName,
  requestReference,
  loginUrl,
  dashboardUrl,
  setupUrl,
} = {}) => {
  const safeApplicantName = toText(applicantName);
  const safeArtistName = toText(artistName);
  const safeReference = toText(requestReference);
  const safeCtaUrl = firstText(toUrl(loginUrl), toUrl(dashboardUrl), toUrl(setupUrl));

  const content = buildEmailLayout({
    greeting: safeApplicantName ? `Hello ${safeApplicantName},` : "Hello,",
    lines: [
      "Your artist access request has been approved.",
      safeArtistName ? `Artist profile: ${safeArtistName}` : "",
      safeReference ? `Reference: ${safeReference}` : "",
      "You can now sign in and continue your setup.",
    ],
    ctaLabel: safeCtaUrl ? "Open artist dashboard" : "",
    ctaUrl: safeCtaUrl,
  });

  return {
    subject: "Your OfficialMerch artist access request is approved",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildArtistAccessRequestApprovedEmail,
};

