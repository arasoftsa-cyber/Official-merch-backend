const { getDb } = require("../config/db");
const { isUserLinkedToArtist } = require("../utils/ownership");

const artistCan = async (user, action, resource, ctx) => {
  if (action === "catalog:product:create" && resource === "self") {
    return false;
  }

  if (action === "catalog:product:update" && resource === "self") {
    if (!ctx || !ctx.db || !ctx.artistId || !user) {
      return false;
    }
    if (user.role === "admin") {
      return true;
    }
    if (user.role === "artist") {
      return isUserLinkedToArtist(ctx.db, user.id, ctx.artistId);
    }
    return false;
  }

  if (action === "artist_dashboard:read" && resource === "self") {
    return user?.role === "artist";
  }

  const allowed = new Set(["artist:catalog:read", "artist:orders:read"]);
  return allowed.has(action);
};

module.exports = { artistCan };
