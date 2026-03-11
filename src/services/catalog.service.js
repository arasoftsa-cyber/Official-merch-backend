const {
  getActiveProducts,
  getAdminProducts,
  getProductsByArtistId,
  getProductById,
} = require("./catalog/reads");
const {
  detectNewMerchFlow,
  validateNewMerch,
  validateListingPhotoFiles,
  validateDesignImageFile,
  normalizeSkuTypes,
  validateProductColors,
  parseMerchMoneyToCents,
  ONBOARDING_ALLOWED_SKU_TYPES,
} = require("./catalog/validation");
const {
  saveProductListingPhotos,
  replaceProductListingPhotos,
  loadProductListingPhotos,
  saveProductDesignImage,
  loadProductDesignImage,
  loadProductDesignImagesMap,
  attachListingPhotosToProducts,
} = require("./catalog/media");
const { createProductWithVariants } = require("./catalog/create");

module.exports = {
  getActiveProducts,
  getAdminProducts,
  getProductsByArtistId,
  getProductById,
  detectNewMerchFlow,
  validateNewMerch,
  validateListingPhotoFiles,
  validateDesignImageFile,
  normalizeSkuTypes,
  validateProductColors,
  parseMerchMoneyToCents,
  ONBOARDING_ALLOWED_SKU_TYPES,
  saveProductListingPhotos,
  replaceProductListingPhotos,
  loadProductListingPhotos,
  saveProductDesignImage,
  loadProductDesignImage,
  loadProductDesignImagesMap,
  attachListingPhotosToProducts,
  createProductWithVariants,
};

