const onboardingOps = require("./operations/onboarding");

module.exports = {
  createArtistOnboardingRequest: onboardingOps.createArtistOnboardingRequest,
  listAdminOnboardingRequests: onboardingOps.listAdminOnboardingRequests,
  approveOnboardingRequest: onboardingOps.approveOnboardingRequest,
  rejectOnboardingRequest: onboardingOps.rejectOnboardingRequest,
  parseOnboardingSkuTypes: onboardingOps.parseOnboardingSkuTypes,
};
