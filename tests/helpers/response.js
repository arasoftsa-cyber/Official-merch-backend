"use strict";

const unwrapArrayBody = (
  response,
  preferredKeys = ["items", "leads", "data", "results"]
) => {
  const body = response?.body;
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return null;
  for (const key of preferredKeys) {
    if (Array.isArray(body[key])) return body[key];
  }
  return null;
};

module.exports = {
  unwrapArrayBody,
};
