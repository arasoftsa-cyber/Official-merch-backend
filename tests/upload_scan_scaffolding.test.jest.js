"use strict";

const {
  UPLOAD_STATUS_AVAILABLE,
  UPLOAD_STATUS_PENDING,
  getInitialUploadStatus,
} = require("../src/storage/uploadStatus");
const { buildMediaAssetInsertPayload } = require("../src/services/mediaAssets.service");
const { __clearSchemaContractCacheForTests } = require("../src/core/db/schemaContract");

describe("upload scan/status scaffolding", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.UPLOAD_SCAN_GATING;
    delete process.env.UPLOAD_SCAN_MODE;
    __clearSchemaContractCacheForTests();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("defaults upload status to available for local workflows", () => {
    expect(getInitialUploadStatus(process.env)).toBe(UPLOAD_STATUS_AVAILABLE);
  });

  it("switches initial upload status to pending when scan gating is enabled", () => {
    process.env.UPLOAD_SCAN_GATING = "true";
    expect(getInitialUploadStatus(process.env)).toBe(UPLOAD_STATUS_PENDING);
  });

  it("enqueues scanner hook only for pending uploads", async () => {
    const enqueueScan = jest.fn().mockResolvedValue({ queued: true });
    jest.doMock("../src/storage/scanner", () => ({
      getUploadScannerAdapter: () => ({ enqueueScan }),
    }));
    const { applyUploadScanStatus } = require("../src/storage/uploadScanPipeline");

    const pendingResult = await applyUploadScanStatus({
      storageResult: { publicUrl: "/uploads/test.png", storageKey: "test.png" },
      env: { UPLOAD_SCAN_GATING: "1" },
    });
    expect(pendingResult.storageResult.status).toBe(UPLOAD_STATUS_PENDING);
    expect(enqueueScan).toHaveBeenCalledTimes(1);

    enqueueScan.mockClear();
    const availableResult = await applyUploadScanStatus({
      storageResult: { publicUrl: "/uploads/test.png", storageKey: "test.png" },
      env: {},
    });
    expect(availableResult.storageResult.status).toBe(UPLOAD_STATUS_AVAILABLE);
    expect(enqueueScan).not.toHaveBeenCalled();
  });

  it("includes canonical media_assets metadata in the insert payload", async () => {
    const trx = (table) => {
      expect(table).toBe("media_assets");
      return {
        columnInfo: async () => ({
          id: {},
          public_url: {},
          status: {},
          storage_key: {},
          provider: {},
          mime_type: {},
          size_bytes: {},
          original_filename: {},
          created_at: {},
        }),
      };
    };
    trx.fn = { now: () => "NOW" };
    trx.schema = { hasTable: async (table) => table === "media_assets" };

    const payload = await buildMediaAssetInsertPayload({
      trx,
      id: "media-id-1",
      publicUrl: "https://cdn.example.com/a.png",
      storageMetadata: {
        status: UPLOAD_STATUS_PENDING,
        storageKey: "uploads/a.png",
        provider: "local",
        mimeType: "image/png",
        size: 123,
        originalFilename: "a.png",
      },
    });

    expect(payload.status).toBe(UPLOAD_STATUS_PENDING);
    expect(payload.storage_key).toBe("uploads/a.png");
    expect(payload.provider).toBe("local");
    expect(payload.mime_type).toBe("image/png");
    expect(payload.size_bytes).toBe(123);
    expect(payload.original_filename).toBe("a.png");
  });
});
