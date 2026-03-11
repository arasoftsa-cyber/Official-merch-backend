"use strict";

class StorageProvider {
  constructor(name = "unknown") {
    this.name = name;
  }

  async saveFile(_input) {
    throw new Error("storage_provider_not_implemented");
  }

  async deleteFile(_input) {
    throw new Error("storage_provider_not_implemented");
  }

  buildPublicUrl(_input) {
    throw new Error("storage_provider_not_implemented");
  }
}

module.exports = StorageProvider;
