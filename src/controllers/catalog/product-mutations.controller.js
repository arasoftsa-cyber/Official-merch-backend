const mutationOps = require("./operations/product-mutations");

module.exports = {
  createProduct: mutationOps.createProduct,
  updateProduct: mutationOps.updateProduct,
  updateProductPhotos: mutationOps.updateProductPhotos,
};
