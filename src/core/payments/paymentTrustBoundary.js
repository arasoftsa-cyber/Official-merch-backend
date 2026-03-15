"use strict";

const crypto = require("crypto");

const FORBIDDEN = { error: "forbidden" };
const INVALID_WEBHOOK_SIGNATURE = { error: "invalid_webhook_signature" };
const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";

const isTruthy = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());
const getNodeEnv = (env = process.env) => String(env.NODE_ENV || "").trim().toLowerCase();
const isTestEnv = (env = process.env) => getNodeEnv(env) === "test";

const isMockPaymentMutationEnabled = (env = process.env) =>
  isTruthy(env.ENABLE_MOCK_PAYMENT_MUTATIONS);

const assertMockPaymentMutationAllowed = ({ req, env = process.env } = {}) => {
  if (isTestEnv(env)) {
    return { allowed: true };
  }

  if (!isMockPaymentMutationEnabled(env)) {
    return {
      allowed: false,
      status: 403,
      body: FORBIDDEN,
    };
  }

  if (!req?.user?.id || String(req.user.role || "").trim().toLowerCase() !== "admin") {
    return {
      allowed: false,
      status: 403,
      body: FORBIDDEN,
    };
  }

  return { allowed: true };
};

const resolveWebhookSecret = ({ provider, env = process.env } = {}) => {
  const normalizedProvider = String(provider || "").trim().toUpperCase();
  if (normalizedProvider) {
    const providerSecret = String(
      env[`PAYMENTS_WEBHOOK_SECRET_${normalizedProvider}`] || ""
    ).trim();
    if (providerSecret) return providerSecret;
  }
  return String(env.PAYMENTS_WEBHOOK_SECRET || "").trim();
};

const parseWebhookSignature = (headerValue) => {
  const match = String(headerValue || "")
    .trim()
    .match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) return null;
  return Buffer.from(match[1].toLowerCase(), "hex");
};

const verifyWebhookSignature = ({
  provider,
  rawBody,
  signatureHeader,
  env = process.env,
} = {}) => {
  const secret = resolveWebhookSecret({ provider, env });
  if (!secret) {
    return {
      ok: false,
      reason: "webhook_secret_missing",
      status: 401,
      body: INVALID_WEBHOOK_SIGNATURE,
    };
  }

  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return {
      ok: false,
      reason: "raw_body_missing",
      status: 401,
      body: INVALID_WEBHOOK_SIGNATURE,
    };
  }

  const providedSignature = parseWebhookSignature(signatureHeader);
  if (!providedSignature) {
    return {
      ok: false,
      reason: "signature_missing_or_malformed",
      status: 401,
      body: INVALID_WEBHOOK_SIGNATURE,
    };
  }

  const expectedSignature = Buffer.from(
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex"),
    "hex"
  );
  if (providedSignature.length !== expectedSignature.length) {
    return {
      ok: false,
      reason: "signature_length_mismatch",
      status: 401,
      body: INVALID_WEBHOOK_SIGNATURE,
    };
  }

  if (!crypto.timingSafeEqual(providedSignature, expectedSignature)) {
    return {
      ok: false,
      reason: "signature_invalid",
      status: 401,
      body: INVALID_WEBHOOK_SIGNATURE,
    };
  }

  return { ok: true };
};

module.exports = {
  WEBHOOK_SIGNATURE_HEADER,
  assertMockPaymentMutationAllowed,
  verifyWebhookSignature,
};
