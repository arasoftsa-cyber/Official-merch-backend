const listOps = require("./operations/list-products");

module.exports = {
  listProducts: listOps.listProducts,
  listArtistProducts: listOps.listArtistProducts,
  getProduct: listOps.getProduct,
};
