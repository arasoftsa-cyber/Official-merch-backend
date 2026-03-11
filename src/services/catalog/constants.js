const ALLOWED_PRODUCT_COLORS = new Set([
  "black",
  "white",
  "yellow",
  "maroon",
  "navy_blue",
]);
const LISTING_PHOTO_FIELD_NAMES = [
  "listing_photo_1",
  "listing_photo_2",
  "listing_photo_3",
  "listing_photo_4",
];
const LISTING_PHOTO_COLLECTION_FIELDS = ["listing_photos", "photos"];
const NEW_MERCH_TRIGGER_FIELDS = new Set([
  "merch_name",
  "merchName",
  "merch_story",
  "merchStory",
  "merch_mrp",
  "merchMrp",
  "mrp_cents",
  "mrpCents",
  "selling_price_cents",
  "sellingPriceCents",
  "vendor_pay",
  "vendorPay",
  "vendor_pay_cents",
  "vendorPayCents",
  "vendor_payout_cents",
  "vendorPayoutCents",
  "our_share",
  "ourShare",
  "our_share_cents",
  "ourShareCents",
  "royalty",
  "royalty_cents",
  "royaltyCents",
  "merch_type",
  "merchType",
  "colors",
]);
const ONBOARDING_ALLOWED_SKU_TYPES = new Set([
  "regular_tshirt",
  "oversized_tshirt",
  "hoodie",
  "oversized_hoodie",
]);
const DESIGN_IMAGE_FIELD_NAMES = ["design_image", "designImage", "design"];
const ALLOWED_DESIGN_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/svg+xml",
]);
const ALLOWED_DESIGN_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg"];

module.exports = {
  ALLOWED_PRODUCT_COLORS,
  LISTING_PHOTO_FIELD_NAMES,
  LISTING_PHOTO_COLLECTION_FIELDS,
  NEW_MERCH_TRIGGER_FIELDS,
  ONBOARDING_ALLOWED_SKU_TYPES,
  DESIGN_IMAGE_FIELD_NAMES,
  ALLOWED_DESIGN_IMAGE_MIME_TYPES,
  ALLOWED_DESIGN_IMAGE_EXTENSIONS,
};
