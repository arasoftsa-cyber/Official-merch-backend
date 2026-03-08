const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");

const CATALOG_SERVICE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/catalog/catalog.service.js"
);
const CATALOG_CONTROLLER_MODULE_PATH = path.resolve(
  __dirname,
  "../src/modules/catalog/catalog.controller.js"
);

const mockFile = (name, mimetype = "image/png") => ({
  originalname: name,
  mimetype,
  buffer: Buffer.from("x"),
});

describe("catalog product onboarding v1 helpers", () => {
  test("normalizeSkuTypes parses and dedupes supported sku types", () => {
    const { normalizeSkuTypes } = require(CATALOG_SERVICE_MODULE_PATH);
    const result = normalizeSkuTypes(
      JSON.stringify(["regular_tshirt", "hoodie", "regular_tshirt"])
    );

    assert.deepEqual(result.invalid, []);
    assert.deepEqual(result.skuTypes, ["regular_tshirt", "hoodie"]);
  });

  test("normalizeSkuTypes reports unsupported sku types", () => {
    const { normalizeSkuTypes } = require(CATALOG_SERVICE_MODULE_PATH);
    const result = normalizeSkuTypes(["hoodie", "cap"]);

    assert.deepEqual(result.skuTypes, ["hoodie"]);
    assert.deepEqual(result.invalid, ["cap"]);
  });

  test("parseOnboardingSkuTypes requires at least one supported sku type", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);
    const result = __test.parseOnboardingSkuTypes({ sku_types: "[]" });

    assert.equal(result.ok, false);
    assert.equal(result.details[0].field, "sku_types");
  });

  test("parseOnboardingSkuTypes accepts comma-separated values", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);
    const result = __test.parseOnboardingSkuTypes({
      sku_types: "regular_tshirt, oversized_hoodie",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.skuTypes, ["regular_tshirt", "oversized_hoodie"]);
  });

  test("validateDesignImageFile requires one image and rejects multiples", () => {
    const { validateDesignImageFile } = require(CATALOG_SERVICE_MODULE_PATH);
    const missing = validateDesignImageFile({}, { required: true });
    const multiple = validateDesignImageFile(
      { design_image: [mockFile("a.png"), mockFile("b.png")] },
      { required: true }
    );

    assert.equal(missing.ok, false);
    assert.equal(multiple.ok, false);
  });

  test("validateDesignImageFile accepts png/jpg/jpeg/svg and rejects unsupported types", () => {
    const { validateDesignImageFile } = require(CATALOG_SERVICE_MODULE_PATH);
    const png = validateDesignImageFile({ design_image: mockFile("a.png", "image/png") }, { required: true });
    const jpg = validateDesignImageFile({ design_image: mockFile("a.jpg", "image/jpeg") }, { required: true });
    const svg = validateDesignImageFile({ design_image: mockFile("a.svg", "image/svg+xml") }, { required: true });
    const bad = validateDesignImageFile({ design_image: mockFile("a.gif", "image/gif") }, { required: true });

    assert.equal(png.ok, true);
    assert.equal(jpg.ok, true);
    assert.equal(svg.ok, true);
    assert.equal(bad.ok, false);
    assert.equal(bad.details[0].field, "design_image");
  });

  test("validateListingPhotoFiles supports 4..6 listing images for approval flow", () => {
    const { validateListingPhotoFiles } = require(CATALOG_SERVICE_MODULE_PATH);
    const fiveFiles = validateListingPhotoFiles(
      {
        listing_photos: [
          mockFile("1.png"),
          mockFile("2.png"),
          mockFile("3.png"),
          mockFile("4.png"),
          mockFile("5.png"),
        ],
      },
      { required: true, minFiles: 4, maxFiles: 6, maxIndexedField: 6 }
    );
    const sevenFiles = validateListingPhotoFiles(
      {
        listing_photos: [
          mockFile("1.png"),
          mockFile("2.png"),
          mockFile("3.png"),
          mockFile("4.png"),
          mockFile("5.png"),
          mockFile("6.png"),
          mockFile("7.png"),
        ],
      },
      { required: true, minFiles: 4, maxFiles: 6, maxIndexedField: 6 }
    );

    assert.equal(fiveFiles.ok, true);
    assert.equal(sevenFiles.ok, false);
  });

  test("validateListingPhotoFiles keeps exact-4 behavior by default", () => {
    const { validateListingPhotoFiles } = require(CATALOG_SERVICE_MODULE_PATH);
    const fourFiles = validateListingPhotoFiles(
      {
        listing_photo_1: mockFile("1.png"),
        listing_photo_2: mockFile("2.png"),
        listing_photo_3: mockFile("3.png"),
        listing_photo_4: mockFile("4.png"),
      },
      { required: true }
    );
    const fiveFiles = validateListingPhotoFiles(
      {
        listing_photos: [
          mockFile("1.png"),
          mockFile("2.png"),
          mockFile("3.png"),
          mockFile("4.png"),
          mockFile("5.png"),
        ],
      },
      { required: true }
    );

    assert.equal(fourFiles.ok, true);
    assert.equal(fiveFiles.ok, false);
  });

  test("artist status toggle guard allows only active/inactive on approved merch", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);

    assert.equal(
      __test.canArtistToggleProductStatus("active", "inactive"),
      true
    );
    assert.equal(
      __test.canArtistToggleProductStatus("inactive", "active"),
      true
    );
    assert.equal(
      __test.canArtistToggleProductStatus("pending", "active"),
      false
    );
    assert.equal(
      __test.canArtistToggleProductStatus("active", "rejected"),
      false
    );
    assert.equal(
      __test.canArtistToggleProductStatus("inactive", "pending"),
      false
    );
    assert.equal(
      __test.canArtistToggleProductStatus("rejected", "active"),
      false
    );
  });

  test("admin patch status guard allows only active/inactive for already approved merch", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);

    assert.equal(
      __test.canAdminPatchProductStatus("active", "inactive"),
      true
    );
    assert.equal(
      __test.canAdminPatchProductStatus("inactive", "active"),
      true
    );
    assert.equal(
      __test.canAdminPatchProductStatus("pending", "inactive"),
      false
    );
    assert.equal(
      __test.canAdminPatchProductStatus("pending", "rejected"),
      false
    );
    assert.equal(
      __test.canAdminPatchProductStatus("rejected", "active"),
      false
    );
  });

  test("status normalization falls back to is_active when status is missing", () => {
    const { __test } = require(CATALOG_CONTROLLER_MODULE_PATH);
    assert.equal(
      __test.normalizeProductStatusFromRecord({ status: "pending", is_active: true }),
      "pending"
    );
    assert.equal(
      __test.normalizeProductStatusFromRecord({ is_active: false }),
      "inactive"
    );
    assert.equal(
      __test.normalizeProductStatusFromRecord({ is_active: true }),
      "active"
    );
  });
});
