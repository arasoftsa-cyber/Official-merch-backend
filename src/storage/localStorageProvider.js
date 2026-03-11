"use strict";

const fs = require("fs");
const path = require("path");
const StorageProvider = require("./storageProvider");
const { getUploadRoot } = require("../core/config/uploadPaths");

const toPosixPath = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");

class LocalStorageProvider extends StorageProvider {
  constructor({ uploadRootDir = getUploadRoot(), publicPrefix = "/uploads" } = {}) {
    super("local");
    this.uploadRootDir = uploadRootDir;
    this.publicPrefix = publicPrefix;
  }

  resolveAbsolutePath(relativePath) {
    const normalized = toPosixPath(relativePath);
    if (!normalized) {
      throw new Error("storage_relative_path_required");
    }
    const candidatePath = path.resolve(this.uploadRootDir, normalized);
    const rootWithSep = `${path.resolve(this.uploadRootDir)}${path.sep}`;
    if (candidatePath !== path.resolve(this.uploadRootDir) && !candidatePath.startsWith(rootWithSep)) {
      throw new Error("storage_invalid_relative_path");
    }
    return { normalizedRelativePath: normalized, absolutePath: candidatePath };
  }

  async saveFile({ relativePath, buffer }) {
    if (!buffer || typeof buffer.length !== "number") {
      throw new Error("storage_buffer_required");
    }
    const { normalizedRelativePath, absolutePath } = this.resolveAbsolutePath(relativePath);
    const directory = path.dirname(absolutePath);
    fs.mkdirSync(directory, { recursive: true });
    await fs.promises.writeFile(absolutePath, buffer);
    return {
      provider: this.name,
      storageKey: normalizedRelativePath,
      relativePath: normalizedRelativePath,
      absolutePath,
      publicUrl: this.buildPublicUrl({ relativePath: normalizedRelativePath }),
      size: buffer.length,
      sizeBytes: buffer.length,
    };
  }

  async deleteFile({ relativePath }) {
    const { absolutePath } = this.resolveAbsolutePath(relativePath);
    try {
      await fs.promises.unlink(absolutePath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  buildPublicUrl({ relativePath }) {
    const normalized = toPosixPath(relativePath);
    if (!normalized) return "";
    return `${String(this.publicPrefix || "/uploads").replace(/\/+$/, "")}/${normalized}`;
  }
}

const createLocalStorageProvider = (options = {}) => new LocalStorageProvider(options);

module.exports = {
  LocalStorageProvider,
  createLocalStorageProvider,
};
