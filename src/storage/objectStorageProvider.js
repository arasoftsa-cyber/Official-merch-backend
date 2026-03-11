"use strict";

const path = require("path");
const StorageProvider = require("./storageProvider");

const OBJECT_PROVIDER = "object";
const REQUIRED_OBJECT_STORAGE_ENV_KEYS = [
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_REGION",
];

const toPosixPath = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
const trimSlashes = (value) => String(value || "").replace(/^\/+|\/+$/g, "");

const requireEnvConfig = (env, key) => {
  const value = String(env?.[key] || "").trim();
  return value || "";
};

class ObjectStorageProvider extends StorageProvider {
  constructor({
    bucket,
    region,
    prefix = "",
    publicBaseUrl = "",
    accessKeyId = "",
    secretAccessKey = "",
    sessionToken = "",
  } = {}) {
    super(OBJECT_PROVIDER);
    this.bucket = String(bucket || "").trim();
    this.region = String(region || "").trim();
    this.prefix = trimSlashes(prefix);
    this.publicBaseUrl = String(publicBaseUrl || "").trim().replace(/\/+$/, "");
    this.credentials = {
      accessKeyId: String(accessKeyId || "").trim(),
      secretAccessKey: String(secretAccessKey || "").trim(),
      sessionToken: String(sessionToken || "").trim(),
    };
  }

  toObjectKey(relativePath) {
    const normalized = toPosixPath(relativePath);
    if (!normalized) {
      throw new Error("storage_relative_path_required");
    }

    // Avoid object keys that traverse parent paths.
    const normalizedNoBacktrack = path.posix.normalize(normalized);
    if (normalizedNoBacktrack.startsWith("../") || normalizedNoBacktrack === "..") {
      throw new Error("storage_invalid_relative_path");
    }

    return this.prefix ? `${this.prefix}/${normalizedNoBacktrack}` : normalizedNoBacktrack;
  }

  async saveFile({ relativePath, buffer }) {
    if (!buffer || typeof buffer.length !== "number") {
      throw new Error("storage_buffer_required");
    }
    const objectKey = this.toObjectKey(relativePath);

    // Scaffold-only behavior: wire here to object storage SDK/client in follow-up pass.
    throw new Error(
      `object_storage_provider_not_implemented: cannot upload key "${objectKey}" for bucket "${this.bucket}"`
    );
  }

  async deleteFile({ relativePath }) {
    const objectKey = this.toObjectKey(relativePath);

    // Scaffold-only behavior: wire here to object storage SDK/client in follow-up pass.
    throw new Error(
      `object_storage_provider_not_implemented: cannot delete key "${objectKey}" for bucket "${this.bucket}"`
    );
  }

  buildPublicUrl({ relativePath }) {
    const objectKey = this.toObjectKey(relativePath);
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${objectKey}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${objectKey}`;
  }
}

const createObjectStorageProviderFromEnv = (env = process.env) => {
  const missing = REQUIRED_OBJECT_STORAGE_ENV_KEYS.filter((key) => !requireEnvConfig(env, key));
  if (missing.length > 0) {
    throw new Error(
      `[storage] STORAGE_PROVIDER=object requires: ${missing.join(", ")}`
    );
  }

  return new ObjectStorageProvider({
    bucket: requireEnvConfig(env, "OBJECT_STORAGE_BUCKET"),
    region: requireEnvConfig(env, "OBJECT_STORAGE_REGION"),
    prefix: requireEnvConfig(env, "OBJECT_STORAGE_PREFIX"),
    publicBaseUrl: requireEnvConfig(env, "OBJECT_STORAGE_PUBLIC_BASE_URL"),
    accessKeyId: requireEnvConfig(env, "OBJECT_STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: requireEnvConfig(env, "OBJECT_STORAGE_SECRET_ACCESS_KEY"),
    sessionToken: requireEnvConfig(env, "OBJECT_STORAGE_SESSION_TOKEN"),
  });
};

module.exports = {
  OBJECT_PROVIDER,
  REQUIRED_OBJECT_STORAGE_ENV_KEYS,
  ObjectStorageProvider,
  createObjectStorageProviderFromEnv,
};
