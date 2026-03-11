"use strict";

const { renderEmailTemplate } = require("./emailTemplates");

const asEmailMisconfigured = (message) => {
  const err = new Error(message);
  err.code = "EMAIL_MISCONFIGURED";
  return err;
};

const getEmailConfig = () => {
  const apiKey = String(process.env.SENDGRID_API_KEY || "").trim();
  const fromEmail = String(process.env.SENDGRID_FROM_EMAIL || "").trim();
  const fromName = String(process.env.SENDGRID_FROM_NAME || "").trim();

  return {
    apiKey,
    fromEmail,
    fromName,
  };
};

const getEmailConfigReadiness = () => {
  const config = getEmailConfig();
  const missingRequired = [];
  const missingOptional = [];

  if (!config.apiKey) missingRequired.push("SENDGRID_API_KEY");
  if (!config.fromEmail) missingRequired.push("SENDGRID_FROM_EMAIL");
  if (!config.fromName) missingOptional.push("SENDGRID_FROM_NAME");

  return {
    configured: missingRequired.length === 0,
    apiKeyPresent: Boolean(config.apiKey),
    fromEmailPresent: Boolean(config.fromEmail),
    fromNamePresent: Boolean(config.fromName),
    missingRequired,
    missingOptional,
  };
};

const isConfigured = () => {
  return getEmailConfigReadiness().configured;
};

const getSendGridClient = () => {
  try {
    // Loaded lazily so missing package/config does not crash app startup.
    return require("@sendgrid/mail");
  } catch (_err) {
    const err = new Error("SendGrid client package is unavailable");
    err.code = "EMAIL_CLIENT_UNAVAILABLE";
    throw err;
  }
};

const buildFromIdentity = ({ fromEmail, fromName }) => {
  if (!fromName) return fromEmail;
  return { email: fromEmail, name: fromName };
};

const maskEmail = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  const at = raw.indexOf("@");
  if (at <= 1) return raw ? "***" : "";
  return `${raw.slice(0, 2)}***${raw.slice(at)}`;
};

const toCustomArgs = (metadata) => {
  const entries = Object.entries(metadata || {}).filter(([key, value]) => {
    if (!key) return false;
    if (value === undefined || value === null) return false;
    return true;
  });
  if (!entries.length) return undefined;

  const mapped = {};
  for (const [key, value] of entries) {
    mapped[String(key)] = String(value);
  }
  return mapped;
};

const sendTransactionalEmail = async ({ to, subject, text, html, metadata }) => {
  const normalizedTo = String(to || "").trim().toLowerCase();
  if (!normalizedTo) {
    throw new Error("Recipient email is required");
  }

  const config = getEmailConfig();
  const readiness = getEmailConfigReadiness();
  if (!readiness.configured) {
    throw asEmailMisconfigured(
      `Missing required email env vars: ${readiness.missingRequired.join(", ")}`
    );
  }

  const client = getSendGridClient();
  client.setApiKey(config.apiKey);

  const payload = {
    to: normalizedTo,
    from: buildFromIdentity(config),
    subject: String(subject || "").trim(),
    text: String(text || "").trim(),
    html: String(html || "").trim(),
  };

  const customArgs = toCustomArgs(metadata);
  if (customArgs) payload.customArgs = customArgs;

  await client.send(payload);
};

const asSendResult = ({
  attempted = false,
  delivered = false,
  queued = false,
  skipped = false,
  errorCode = "",
  errorMessage = "",
} = {}) => ({
  attempted: Boolean(attempted),
  delivered: Boolean(delivered),
  queued: Boolean(queued),
  skipped: Boolean(skipped),
  errorCode: String(errorCode || ""),
  errorMessage: String(errorMessage || ""),
});

const sendEmailByTemplate = async ({ templateKey, to, payload, metadata } = {}) => {
  const recipient = String(to || "").trim().toLowerCase();
  if (!recipient) {
    return asSendResult({
      skipped: true,
      errorCode: "EMAIL_RECIPIENT_REQUIRED",
      errorMessage: "Recipient email is required",
    });
  }

  let rendered;
  try {
    rendered = renderEmailTemplate({ templateKey, payload });
  } catch (err) {
    console.warn("[email] template render failed", {
      templateKey: String(templateKey || "").trim() || "undefined",
      code: err?.code || "EMAIL_TEMPLATE_INVALID",
    });
    return asSendResult({
      skipped: true,
      errorCode: err?.code || "EMAIL_TEMPLATE_INVALID",
      errorMessage: err?.message || "Unable to render email template",
    });
  }

  try {
    await sendTransactionalEmail({
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      metadata: {
        templateKey: rendered.templateKey,
        ...(metadata || {}),
      },
    });
    return asSendResult({
      attempted: true,
      delivered: true,
      queued: true,
    });
  } catch (err) {
    const code = String(err?.code || "EMAIL_SEND_FAILED");
    const isSkip = code === "EMAIL_MISCONFIGURED" || code === "EMAIL_CLIENT_UNAVAILABLE";
    const level = isSkip ? "warn" : "error";
    const readiness = code === "EMAIL_MISCONFIGURED" ? getEmailConfigReadiness() : null;
    console[level]("[email] send failed", {
      templateKey: rendered.templateKey,
      to: maskEmail(recipient),
      code,
      ...(readiness
        ? {
            missingRequired: readiness.missingRequired,
            missingOptional: readiness.missingOptional,
          }
        : {}),
    });
    return asSendResult({
      attempted: !isSkip,
      delivered: false,
      queued: false,
      skipped: isSkip,
      errorCode: code,
      errorMessage: String(err?.message || "Failed to send email"),
    });
  }
};

module.exports = {
  getEmailConfig,
  getEmailConfigReadiness,
  isConfigured,
  sendTransactionalEmail,
  sendEmailByTemplate,
};
