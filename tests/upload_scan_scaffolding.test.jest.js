"use strict";

const {
  UPLOAD_STATUS_AVAILABLE,
  UPLOAD_STATUS_PENDING,
  getInitialUploadStatus,
} = require("../src/storage/uploadStatus");
const { buildMediaAssetInsertPayload } = require("../src/services/mediaAssets.service");

describe("upload scan/status scaffolding", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.UPLOAD_SCAN_GATING;
    delete process.env.UPLOAD_SCAN_MODE;
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

  it("includes status metadata in media_assets payload only when schema supports it", async () => {
    const trxWithStatus = (table) => {
      expect(table).toBe("media_assets");
      return {
        columnInfo: async () => ({
          id: {},
          public_url: {},
          status: {},
          created_at: {},
        }),
      };
    };
    trxWithStatus.fn = { now: () => "NOW" };

    const payloadWithStatus = await buildMediaAssetInsertPayload({
      trx: trxWithStatus,
      id: "media-id-1",
      publicUrl: "https://cdn.example.com/a.png",
      storageMetadata: { status: UPLOAD_STATUS_PENDING },
    });
    expect(payloadWithStatus.status).toBe(UPLOAD_STATUS_PENDING);

    const trxWithoutStatus = () => ({
      columnInfo: async () => ({
        id: {},
        public_url: {},
      }),
    });
    trxWithoutStatus.fn = { now: () => "NOW" };

    const payloadWithoutStatus = await buildMediaAssetInsertPayload({
      trx: trxWithoutStatus,
      id: "media-id-2",
      publicUrl: "https://cdn.example.com/b.png",
      storageMetadata: { status: UPLOAD_STATUS_PENDING },
    });
    expect(Object.prototype.hasOwnProperty.call(payloadWithoutStatus, "status")).toBe(false);
  });
});
