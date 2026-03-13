const { withStatus } = require("../status");

const toCreateNewMerchResponse = (created) => ({
  ok: true,
  product_id: created.productId,
  productId: created.productId,
  created_at: created.createdAt,
  status: created.status,
  listingPhotoUrl: created.listingPhotoUrls?.[0] || "",
  photoUrls: Array.isArray(created.listingPhotoUrls) ? created.listingPhotoUrls : [],
  listingPhotoUrls: Array.isArray(created.listingPhotoUrls) ? created.listingPhotoUrls : [],
});

const toCreateProductResponse = ({ productRow, variantRow, listingPhotoUrls }) => {
  const safeListingPhotos = Array.isArray(listingPhotoUrls) ? listingPhotoUrls : [];
  return {
    ok: true,
    id: productRow.id,
    productId: productRow.id,
    listingPhotoUrl: safeListingPhotos[0] || "",
    photoUrls: safeListingPhotos,
    listingPhotoUrls: safeListingPhotos,
    product: {
      id: productRow.id,
      title: productRow.title,
      description: productRow.description,
      isActive: Boolean(productRow.isActive),
      status: productRow.status,
      listingPhotoUrl: safeListingPhotos[0] || "",
      photoUrls: safeListingPhotos,
      listingPhotoUrls: safeListingPhotos,
    },
    defaultVariant: variantRow || null,
  };
};

const toUpdateProductResponse = ({ productRow, primaryVariant }) => ({
  product: withStatus({
    id: productRow.id,
    title: productRow.title,
    description: productRow.description,
    isActive: Boolean(productRow.isActive),
    status: productRow.status,
    rejectionReason: productRow.rejectionReason ?? null,
    rejection_reason: productRow.rejectionReason ?? null,
    skuTypes: Array.isArray(productRow.skuTypes) ? productRow.skuTypes : [],
    sku_types: Array.isArray(productRow.skuTypes) ? productRow.skuTypes : [],
  }),
  defaultVariant: primaryVariant || null,
});

const toUpdateProductPhotosResponse = ({ productId, listingPhotoUrls }) => ({
  ok: true,
  product_id: productId,
  productId,
  listingPhotoUrls: Array.isArray(listingPhotoUrls) ? listingPhotoUrls : [],
});

module.exports = {
  toCreateNewMerchResponse,
  toCreateProductResponse,
  toUpdateProductResponse,
  toUpdateProductPhotosResponse,
};
