"use strict";

const { buildEmailLayout } = require("./layout.template");
const { toText, toUrl, asNonNegativeNumber } = require("./template.helpers");

const buildDropQuizLeadThankYouEmail = ({
  customerName,
  dropName,
  artistName,
  dropUrl,
  followUpWindowHours,
} = {}) => {
  const safeName = toText(customerName);
  const safeDropName = toText(dropName);
  const safeArtistName = toText(artistName);
  const safeDropUrl = toUrl(dropUrl);
  const followUpHours = asNonNegativeNumber(followUpWindowHours);

  const lines = [
    "Thanks for participating in the OfficialMerch drop quiz.",
    safeDropName ? `Drop: ${safeDropName}` : "",
    safeArtistName ? `Artist: ${safeArtistName}` : "",
    followUpHours
      ? `If selected, we will contact you within ${followUpHours} hour(s).`
      : "If selected, we will contact you with next steps.",
  ];

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines,
    ctaLabel: safeDropUrl ? "View drop details" : "",
    ctaUrl: safeDropUrl,
  });

  return {
    subject: safeDropName
      ? `Thanks for your ${safeDropName} quiz submission`
      : "Thanks for your OfficialMerch quiz submission",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildDropQuizLeadThankYouEmail,
};

