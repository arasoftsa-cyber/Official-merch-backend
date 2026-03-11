const getRole = (user) => (user ? (user.role || user.userRole || "").toString().toLowerCase() : "");
const ADMIN_ROLES = new Set(["admin"]);
const isAdmin = (user) => ADMIN_ROLES.has(getRole(user));
const isArtist = (user) => getRole(user) === "artist";

module.exports = {
  getRole,
  isAdmin,
  isArtist,
};
