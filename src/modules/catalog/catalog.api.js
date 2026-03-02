'use strict';

// Public API for other modules to call into Catalog.
// Keep this file SMALL and stable. Everything else stays internal.
const { createProductWithVariants } = require('./catalog.service');

module.exports = {
  createProductWithVariants,
};
