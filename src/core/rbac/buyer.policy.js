const buyerCan = (action, resource, ctx) => {
  if (typeof action !== "string") return false;
  return action.startsWith("self:");
};

module.exports = { buyerCan };
