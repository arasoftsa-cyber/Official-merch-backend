"use strict";

const { normalizeStorageResult } = require("../src/storage/mediaMetadata");

describe("storage media metadata normalization", () => {
  it("normalizes provider and upload file metadata into a consistent shape", () => {
    const result = normalizeStorageResult({
      saved: {
        provider: "local",
        relativePath: "media-assets/test.png",
        publicUrl: "/uploads/media-assets/test.png",
        sizeBytes: 1234,
      },
      file: {
        mimetype: "image/png",
        originalname: "test.png",
      },
      status: "available",
    });

    expect(result).toMatchObject({
      storageKey: "media-assets/test.png",
      publicUrl: "/uploads/media-assets/test.png",
      provider: "local",
      mimeType: "image/png",
      size: 1234,
      originalFilename: "test.png",
      status: "available",
      relativePath: "media-assets/test.png",
      sizeBytes: 1234,
    });
  });

  it("falls back to relativePath and buffer size when provider fields are missing", () => {
    const result = normalizeStorageResult({
      saved: {},
      file: {
        mimetype: "image/jpeg",
        originalname: "cover.jpg",
        buffer: Buffer.from("abc"),
      },
      relativePath: "products/cover.jpg",
    });

    expect(result.storageKey).toBe("products/cover.jpg");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.size).toBe(3);
    expect(result.sizeBytes).toBe(3);
  });
});
