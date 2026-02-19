const { can } = require("../policies");

const FORBIDDEN = { error: "forbidden" };

const requirePolicy = (action, resource, ctxBuilder) => async (req, res, next) => {
  const ctx = typeof ctxBuilder === "function" ? await ctxBuilder(req) : undefined;
  const result = can(req.user, action, resource, ctx);
  const allowed = await Promise.resolve(result);

  if (!allowed) {
    res.setHeader("X-Policy-Action", action);
    res.setHeader("X-Policy-Resource", resource);
    res.setHeader("X-Policy-UserRole", req.user?.role || "");
    res.setHeader("X-Policy-UserId", req.user?.id || "");
    res.setHeader("X-Policy-HasCtx", ctx ? "1" : "0");
    res.setHeader("X-Policy-CtxArtistId", ctx?.artistId || "");
    return res.status(403).json(FORBIDDEN);
  }

  return next();
};

module.exports = { requirePolicy };
