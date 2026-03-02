'use strict';

// Public API for other modules to call into Users.
// Keep this file SMALL and stable. Everything else stays internal.
const { createUser, findByEmail, findById } = require('./user.service');

module.exports = {
  createUser,
  findByEmail,
  findById,
};
