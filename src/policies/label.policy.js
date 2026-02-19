const { isLabelLinkedToArtist } = require("../utils/ownership");

const labelCan = async (user, action, resource, ctx) => {
  if (typeof action !== "string") return false;
  if (action.includes(":write") || action.includes(":mutate")) {
    return false;
  }

  if (action === "label:sales:read" && resource === "linked") {
    if (!ctx || !ctx.db || !ctx.labelId || !ctx.artistId) {
      return false;
    }
    return isLabelLinkedToArtist(ctx.db, ctx.labelId, ctx.artistId);
  }

  if (action === "label_dashboard:read" && resource === "self") {
    return user?.role === "label";
  }

  if (action === "label:artist:read") {
    return true;
  }

  if (action === "label:artist:write") {
    return false;
  }

  return false;
};

module.exports = { labelCan };
