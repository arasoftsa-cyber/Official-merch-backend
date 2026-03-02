"use strict";

const ok = (res, data) => res.json(data);

const fail = (res, status, code, message, extra) => {
  const payload = {
    error: code,
    message: message || code,
    ...(extra && typeof extra === "object" ? extra : {}),
  };
  return res.status(status).json(payload);
};

module.exports = {
  ok,
  fail,
};
