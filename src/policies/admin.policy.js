const adminCan = (action, resource, ctx) => {
  // planned Phase 3 actions: admin:ownership:write, admin:ownership:read
  return true; // admin omnipotent for now
};

module.exports = { adminCan };
