process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "media-parser-test-secret";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "media-parser-refresh-secret";

const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { signAccessToken } = require("../src/utils/jwt");
const { silenceTestLogs } = require("./helpers/logging");

const MEDIA_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/mediaAssets.routes.js"
);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const buildPngBuffer = (size = PNG_SIGNATURE.length) => {
  const buffer = Buffer.alloc(size, 0);
  PNG_SIGNATURE.copy(buffer, 0);
  return buffer;
};

const buildAuthHeader = (role = "admin") => ({
  Authorization: `Bearer ${signAccessToken({
    sub: `${role}-1`,
    email: `${role}@example.com`,
    role,
  })}`,
});

const createMediaHarness = () => {
  const saveFile = jest.fn().mockResolvedValue({
    provider: "local",
    relativePath: "media-assets/test.png",
    publicUrl: "/uploads/media-assets/test.png",
    storageKey: "media-assets/test.png",
    mimeType: "image/png",
    size: PNG_SIGNATURE.length,
    originalFilename: "test.png",
  });
  const finalizeUploadedMedia = jest.fn(async ({ saved }) => saved);
  const createMediaAsset = jest.fn().mockResolvedValue({
    id: "media-1",
    publicUrl: "http://localhost:3000/uploads/media-assets/test.png",
  });
  const getDb = jest.fn(() => ({
    fn: { now: () => new Date(1741392000000).toISOString() },
  }));

  jest.resetModules();
  jest.doMock("../src/core/db/db.js", () => ({
    getDb,
  }));
  jest.doMock("../src/storage/index.js", () => ({
    getStorageProvider: () => ({
      saveFile,
    }),
  }));
  jest.doMock("../src/storage/mediaUploadLifecycle.js", () => ({
    finalizeUploadedMedia,
  }));
  jest.doMock("../src/services/mediaAssets.service.js", () => ({
    createMediaAsset,
  }));

  const mediaAssetsRouter = require(MEDIA_ROUTE_MODULE_PATH);
  const app = express();
  app.use("/api/media-assets", mediaAssetsRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: "internal_server_error" }));

  return { app, getDb, saveFile, finalizeUploadedMedia, createMediaAsset };
};

describe("media assets multipart parser hardening", () => {
  let restoreLogs = () => {};

  beforeAll(() => {
    restoreLogs = silenceTestLogs(["log", "warn", "error"]);
  });

  afterAll(() => {
    restoreLogs();
  });

  afterEach(() => {
    jest.resetModules();
  });

  it("rejects multipart requests that omit the expected file field", async () => {
    const { app, saveFile, createMediaAsset } = createMediaHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader())
      .field("caption", "missing-file");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "validation_error", field: "file" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("accepts authorized admin uploads through the shared multipart middleware", async () => {
    const { app, saveFile, finalizeUploadedMedia, createMediaAsset } = createMediaHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader("admin"))
      .attach("file", buildPngBuffer(), {
        filename: "ok.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      publicUrl: "http://localhost:3000/uploads/media-assets/test.png",
    });
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(finalizeUploadedMedia).toHaveBeenCalledTimes(1);
    expect(createMediaAsset).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong file field names and unexpected companion fields", async () => {
    const { app, saveFile, createMediaAsset } = createMediaHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader())
      .field("metadata", "{\"ignored\":true}")
      .attach("avatar", buildPngBuffer(), {
        filename: "avatar.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "validation_error", field: "file" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects empty file uploads", async () => {
    const { app, saveFile, createMediaAsset } = createMediaHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader())
      .attach("file", Buffer.alloc(0), {
        filename: "empty.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "validation_error", field: "file" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects unsupported mimetypes without crashing", async () => {
    const { app, saveFile, createMediaAsset } = createMediaHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader())
      .attach("file", Buffer.from("plain text upload"), {
        filename: "note.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "validation_error", field: "file" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects oversized file uploads with a controlled validation response", async () => {
    const { app, saveFile, createMediaAsset } = createMediaHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader())
      .attach("file", buildPngBuffer(6000), {
        filename: "too-large.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "validation_error", field: "file" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects malformed multipart boundaries without a server crash", async () => {
    const { app, saveFile, createMediaAsset } = createMediaHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader())
      .set("Content-Type", "multipart/form-data; boundary=BrokenBoundary")
      .send(
        "--BrokenBoundary\r\n" +
          'Content-Disposition: form-data; name="file"; filename="broken.png"\r\n' +
          "Content-Type: image/png\r\n\r\n"
      );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "validation_error", field: "file" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects malformed metadata field shapes safely when no usable file is present", async () => {
    const { app, saveFile, createMediaAsset } = createMediaHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader())
      .field("metadata", "{\"broken\":")
      .field("metadata", "[]");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "validation_error", field: "file" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects authenticated non-admin uploads before persistence", async () => {
    const { app, saveFile, createMediaAsset } = createMediaHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader("buyer"))
      .attach("file", buildPngBuffer(), {
        filename: "blocked.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "forbidden" });
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });
});
