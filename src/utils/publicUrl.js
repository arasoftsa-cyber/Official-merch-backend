const HTTP_URL_RE = /^https?:\/\//i;

const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

const getBackendPublicBaseUrl = () => {
  const envBase =
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    process.env.PUBLIC_BASE_URL ||
    "";
  if (envBase) return trimTrailingSlash(envBase);
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
};

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

