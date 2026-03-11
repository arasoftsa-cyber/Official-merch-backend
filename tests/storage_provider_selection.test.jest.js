"use strict";

describe("storage provider selection", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.STORAGE_PROVIDER;
    delete process.env.OBJECT_STORAGE_BUCKET;
    delete process.env.OBJECT_STORAGE_REGION;
    delete process.env.OBJECT_STORAGE_PUBLIC_BASE_URL;
    delete process.env.OBJECT_STORAGE_PREFIX;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("defaults to local provider when STORAGE_PROVIDER is unset", () => {
    const { createStorageProvider } = require("../src/storage");
    const provider = createStorageProvider();
    expect(provider.name).toBe("local");
  });

  it("throws a clear config error when STORAGE_PROVIDER=object without required env", () => {
    process.env.STORAGE_PROVIDER = "object";
    const { createStorageProvider } = require("../src/storage");
    expect(() => createStorageProvider()).toThrow(
      '[storage] STORAGE_PROVIDER=object requires: OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_REGION'
    );
  });

  it("creates object provider when required env is present", () => {
    process.env.STORAGE_PROVIDER = "object";
    process.env.OBJECT_STORAGE_BUCKET = "media-bucket";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.OBJECT_STORAGE_PREFIX = "uploads";
    process.env.OBJECT_STORAGE_PUBLIC_BASE_URL = "https://cdn.example.com";

    const { createStorageProvider } = require("../src/storage");
    const provider = createStorageProvider();

    expect(provider.name).toBe("object");
    expect(provider.buildPublicUrl({ relativePath: "media-assets/test.jpg" })).toBe(
      "https://cdn.example.com/uploads/media-assets/test.jpg"
    );
  });
});
