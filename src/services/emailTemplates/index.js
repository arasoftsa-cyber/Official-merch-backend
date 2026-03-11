"use strict";

const { buildPasswordResetEmail } = require("./passwordReset.template");
const { buildWelcomeAccountEmail } = require("./welcomeAccount.template");
const { buildEmailVerificationEmail } = require("./emailVerification.template");
const { buildPartnerAccountApprovedEmail } = require("./partnerAccountApproved.template");
const { buildPartnerAccountRejectedEmail } = require("./partnerAccountRejected.template");
const {
  buildArtistAccessRequestReceivedEmail,
} = require("./artistAccessRequestReceived.template");
const {
  buildArtistAccessRequestApprovedEmail,
} = require("./artistAccessRequestApproved.template");
const {
  buildArtistAccessRequestRejectedEmail,
} = require("./artistAccessRequestRejected.template");
const { buildOrderConfirmationEmail } = require("./orderConfirmation.template");
const { buildOrderStatusProcessingEmail } = require("./orderStatusProcessing.template");
const { buildOrderStatusShippedEmail } = require("./orderStatusShipped.template");
const { buildOrderStatusDeliveredEmail } = require("./orderStatusDelivered.template");
const { buildOrderStatusCancelledEmail } = require("./orderStatusCancelled.template");
const { buildOrderStatusRefundedEmail } = require("./orderStatusRefunded.template");
const { buildOrderStatusUpdateEmail } = require("./orderStatusUpdate.template");
const { buildShipmentDispatchedEmail } = require("./shipmentDispatched.template");
const { buildDropQuizLeadThankYouEmail } = require("./dropQuizLeadThankYou.template");
const { buildContactFormReceivedEmail } = require("./contactFormReceived.template");
const {
  buildAdminNotifyNewArtistAccessRequestEmail,
} = require("./adminNotifyNewArtistAccessRequest.template");
const { buildAdminApprovedAccountEmail } = require("./adminApprovedAccount.template");
const { buildAdminRejectedAccountEmail } = require("./adminRejectedAccount.template");
const {
  EMAIL_TIERS,
  EMAIL_TEMPLATE_CATALOG,
  getTemplateCatalogEntry,
  listTemplateKeysByTier,
} = require("./catalog");

const TEMPLATE_BUILDERS = Object.freeze({
  "password-reset": buildPasswordResetEmail,
  "welcome-account": buildWelcomeAccountEmail,
  "email-verification": buildEmailVerificationEmail,
  "partner-account-approved": buildPartnerAccountApprovedEmail,
  "partner-account-rejected": buildPartnerAccountRejectedEmail,
  "artist-access-request-received": buildArtistAccessRequestReceivedEmail,
  "artist-access-request-approved": buildArtistAccessRequestApprovedEmail,
  "artist-access-request-rejected": buildArtistAccessRequestRejectedEmail,
  "order-confirmation": buildOrderConfirmationEmail,
  "order-status-processing": buildOrderStatusProcessingEmail,
  "order-status-shipped": buildOrderStatusShippedEmail,
  "order-status-delivered": buildOrderStatusDeliveredEmail,
  "order-status-cancelled": buildOrderStatusCancelledEmail,
  "order-status-refunded": buildOrderStatusRefundedEmail,
  "drop-quiz-lead-thank-you": buildDropQuizLeadThankYouEmail,
  "contact-form-received": buildContactFormReceivedEmail,
  "admin-notify-new-artist-access-request": buildAdminNotifyNewArtistAccessRequestEmail,

  // Backward-compatible keys used by existing call-sites.
  "order-status-update": buildOrderStatusUpdateEmail,
  "shipment-dispatched": buildShipmentDispatchedEmail,
  "admin-approved-account": buildAdminApprovedAccountEmail,
  "admin-rejected-account": buildAdminRejectedAccountEmail,
});

const renderEmailTemplate = ({ templateKey, payload } = {}) => {
  const normalizedTemplateKey = String(templateKey || "").trim().toLowerCase();
  const templateBuilder = TEMPLATE_BUILDERS[normalizedTemplateKey];
  if (!templateBuilder) {
    const err = new Error(`Unknown email template key: ${normalizedTemplateKey || "undefined"}`);
    err.code = "EMAIL_TEMPLATE_UNKNOWN";
    throw err;
  }

  const rendered = templateBuilder(payload || {});
  const subject = String(rendered?.subject || "").trim();
  const text = String(rendered?.text || "").trim();
  const html = String(rendered?.html || "").trim();

  if (!subject || (!text && !html)) {
    const err = new Error(
      `Template "${normalizedTemplateKey}" must return subject and at least one body`
    );
    err.code = "EMAIL_TEMPLATE_INVALID";
    throw err;
  }

  return {
    templateKey: normalizedTemplateKey,
    subject,
    text,
    html,
  };
};

module.exports = {
  TEMPLATE_BUILDERS,
  renderEmailTemplate,
  EMAIL_TIERS,
  EMAIL_TEMPLATE_CATALOG,
  getTemplateCatalogEntry,
  listTemplateKeysByTier,
};
