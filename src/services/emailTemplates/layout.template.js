"use strict";

const DEFAULT_APP_NAME = "OfficialMerch";

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeLines = (lines) =>
  (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || "").trim())
    .filter(Boolean);

const getBranding = () => {
  const appName = String(process.env.APP_NAME || DEFAULT_APP_NAME).trim() || DEFAULT_APP_NAME;
  const supportEmail = String(
    process.env.SUPPORT_EMAIL || process.env.SENDGRID_FROM_EMAIL || ""
  )
    .trim()
    .toLowerCase();

  return {
    appName,
    supportEmail,
  };
};

const buildEmailLayout = ({
  greeting = "Hello,",
  lines = [],
  ctaLabel = "",
  ctaUrl = "",
  footerLines = [],
} = {}) => {
  const { appName, supportEmail } = getBranding();
  const contentLines = normalizeLines(lines);
  const safeGreeting = String(greeting || "").trim() || "Hello,";
  const safeCtaLabel = String(ctaLabel || "").trim();
  const safeCtaUrl = String(ctaUrl || "").trim();
  const safeFooterLines = normalizeLines(footerLines);

  const textParts = [safeGreeting];
  if (contentLines.length) {
    textParts.push("", ...contentLines);
  }
  if (safeCtaLabel && safeCtaUrl) {
    textParts.push("", `${safeCtaLabel}: ${safeCtaUrl}`);
  }
  textParts.push("", "Thanks,", `${appName} Team`);
  if (safeFooterLines.length) {
    textParts.push("", ...safeFooterLines);
  }
  if (supportEmail) {
    textParts.push(`Support: ${supportEmail}`);
  }

  const htmlParts = [
    '<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111827;max-width:600px;">',
    `<p>${escapeHtml(safeGreeting)}</p>`,
    ...contentLines.map((line) => `<p>${escapeHtml(line)}</p>`),
  ];

  if (safeCtaLabel && safeCtaUrl) {
    htmlParts.push(
      `<p><a href="${escapeHtml(safeCtaUrl)}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(safeCtaLabel)}</a></p>`
    );
  }

  htmlParts.push(`<p>Thanks,<br/>${escapeHtml(appName)} Team</p>`);
  for (const line of safeFooterLines) {
    htmlParts.push(
      `<p style="color:#4b5563;font-size:14px;margin:0 0 8px;">${escapeHtml(line)}</p>`
    );
  }
  if (supportEmail) {
    htmlParts.push(
      `<p style="color:#4b5563;font-size:14px;margin:0;">Support: <a href="mailto:${escapeHtml(
        supportEmail
      )}">${escapeHtml(supportEmail)}</a></p>`
    );
  }
  htmlParts.push("</div>");

  return {
    text: textParts.join("\n"),
    html: htmlParts.join(""),
  };
};

module.exports = {
  buildEmailLayout,
  escapeHtml,
};

