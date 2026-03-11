"use strict";

class ScannerAdapter {
  constructor(name = "unknown") {
    this.name = name;
  }

  async enqueueScan(_payload) {
    throw new Error("upload_scanner_not_implemented");
  }
}

module.exports = ScannerAdapter;
