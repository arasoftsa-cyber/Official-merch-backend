const { adminCan } = require("./admin.policy");
const { buyerCan } = require("./buyer.policy");
const { artistCan } = require("./artist.policy");
const { labelCan } = require("./label.policy");
const { dropCan } = require("./drop.policy");

const can = (user, action, resource, ctx) => {
  if (!user || !user.role) return false;

  if (action.startsWith("drop:")) {
    return dropCan(user, action, resource, ctx);
  }

  switch (user.role) {
    case "admin":
      return adminCan(action, resource, ctx);
    case "buyer":
      return buyerCan(action, resource, ctx);
    case "artist":
      return artistCan(user, action, resource, ctx);
    case "label":
      return labelCan(user, action, resource, ctx);
    default:
      return false;
  }
};

module.exports = { can };
