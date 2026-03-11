"use strict";

const ScannerAdapter = require("./scannerAdapter");

class NoopScannerAdapter extends ScannerAdapter {
  constructor() {
    super("noop");
  }

  async enqueueScan(payload = {}) {
    return {
      queued: false,
      scanner: this.name,
      reason: "scanner_not_configured",
      mediaAssetId: payload.mediaAssetId || null,
      storageKey: payload.storageKey || "",
    };
  }
}

const createNoopScannerAdapter = () => new NoopScannerAdapter();

module.exports = {
  NoopScannerAdapter,
  createNoopScannerAdapter,
};
