const HTTP_URL_RE = /^https?:\/\//i;
const { resolveBackendBaseUrl } = require("../config/appOrigin");

const getBackendPublicBaseUrl = () => resolveBackendBaseUrl();

const toAbsolutePublicUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (HTTP_URL_RE.test(raw)) return raw;
  const normalizedPath = raw.startsWith("/") ? raw : `/${raw}`;
  return `${getBackendPublicBaseUrl()}${normalizedPath}`;
};

module.exports = {
  getBackendPublicBaseUrl,
  toAbsolutePublicUrl,
};
