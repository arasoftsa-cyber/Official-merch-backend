const {
  normalizeProductStatusValue,
  normalizeProductStatusFromRecord,
  canArtistToggleProductStatus,
  canAdminPatchProductStatus,
} = require("./status");
const productsController = require("./products.controller");
const onboardingController = require("./onboarding.controller");
const productMutationsController = require("./product-mutations.controller");

module.exports = {
  ...productsController,
  createArtistOnboardingRequest: onboardingController.createArtistOnboardingRequest,
  listAdminOnboardingRequests: onboardingController.listAdminOnboardingRequests,
  approveOnboardingRequest: onboardingController.approveOnboardingRequest,
  rejectOnboardingRequest: onboardingController.rejectOnboardingRequest,
  ...productMutationsController,
  __test: {
    normalizeProductStatusValue,
    normalizeProductStatusFromRecord,
    canArtistToggleProductStatus,
    canAdminPatchProductStatus,
    parseOnboardingSkuTypes: onboardingController.parseOnboardingSkuTypes,
  },
};
