const { can } = require("../rbac");

const FORBIDDEN = { error: "forbidden" };

const isValidPolicyToken = (value) =>
  typeof value === "string" && String(value).trim().length > 0;

const requirePolicy = (action, resource, ctxBuilder) => async (req, res, next) => {
  if (!isValidPolicyToken(action) || !isValidPolicyToken(resource)) {
    return res.status(403).json(FORBIDDEN);
  }

  if (typeof ctxBuilder !== "undefined" && typeof ctxBuilder !== "function") {
    return res.status(403).json(FORBIDDEN);
  }

  const ctx = typeof ctxBuilder === "function" ? await ctxBuilder(req) : undefined;
  const result = can(req.user, action, resource, ctx);
  const allowed = await Promise.resolve(result);

  if (!allowed) {
    return res.status(403).json(FORBIDDEN);
  }

  return next();
};

module.exports = { requirePolicy };
