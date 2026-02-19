const { isLabelLinkedToArtist, isUserLinkedToArtist } = require("../utils/ownership");

const dropCan = async (user, action, resource, ctx) => {
  if (!user) return false;
  const db = ctx?.db;
  const userId = ctx?.userId;

  if (user.role === "admin") {
    return true;
  }

  if (action === "drop:create" && resource === "self") {
    if (!db || !userId) return false;
    if (ctx.artistId) {
      return isUserLinkedToArtist(db, userId, ctx.artistId);
    }
    if (ctx.labelId) {
      return user.role === "label";
    }
    return false;
  }

  const drop = ctx?.drop;
  if (!drop || !db || !userId) return false;

  if (["drop:add-product", "drop:publish", "drop:unpublish", "drop:archive"].includes(action)) {
    if (drop.artist_id) {
      return isUserLinkedToArtist(db, userId, drop.artist_id);
    }
    if (drop.label_id) {
      return user.role === "label";
    }
  }

  return false;
};

module.exports = { dropCan };
