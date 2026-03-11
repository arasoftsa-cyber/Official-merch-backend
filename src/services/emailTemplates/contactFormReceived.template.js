"use strict";

const { buildEmailLayout } = require("./layout.template");
const { toText, toUrl, formatDate } = require("./template.helpers");

const buildContactFormReceivedEmail = ({
  customerName,
  ticketId,
  submittedAt,
  supportUrl,
} = {}) => {
  const safeName = toText(customerName);
  const safeTicketId = toText(ticketId);
  const safeSubmittedAt = formatDate(submittedAt);
  const safeSupportUrl = toUrl(supportUrl);

  const content = buildEmailLayout({
    greeting: safeName ? `Hello ${safeName},` : "Hello,",
    lines: [
      "We received your message and our team will review it shortly.",
      safeTicketId ? `Reference: ${safeTicketId}` : "",
      safeSubmittedAt ? `Submitted: ${safeSubmittedAt}` : "",
      "Please keep this reference for follow-up.",
    ],
    ctaLabel: safeSupportUrl ? "View support page" : "",
    ctaUrl: safeSupportUrl,
  });

  return {
    subject: safeTicketId
      ? `OfficialMerch support request received (${safeTicketId})`
      : "OfficialMerch support request received",
    text: content.text,
    html: content.html,
  };
};

module.exports = {
  buildContactFormReceivedEmail,
};

