process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "authz-mutation-test-secret";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "authz-mutation-refresh-secret";

const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { signAccessToken } = require("../src/utils/jwt");
const { silenceTestLogs } = require("./helpers/logging");

const PAYMENTS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/payments.routes.js"
);
const MEDIA_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/mediaAssets.routes.js"
);

const buildAuthHeader = (payload = { sub: "user-1", email: "user@example.com", role: "buyer" }) => ({
  Authorization: `Bearer ${signAccessToken(payload)}`,
});

const createMutationHarness = () => {
  const getDb = jest.fn(() => {
    throw new Error("db_should_not_be_touched_for_rejected_requests");
  });
  const saveFile = jest.fn();
  const createMediaAsset = jest.fn();

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
    finalizeUploadedMedia: jest.fn(),
  }));
  jest.doMock("../src/services/mediaAssets.service.js", () => ({
    createMediaAsset,
  }));

  const paymentsRouter = require(PAYMENTS_ROUTE_MODULE_PATH);
  const mediaAssetsRouter = require(MEDIA_ROUTE_MODULE_PATH);
  const app = express();
  app.use(express.json());
  app.use("/api/payments", paymentsRouter);
  app.use("/api/media-assets", mediaAssetsRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: "internal_server_error" }));

  return { app, getDb, saveFile, createMediaAsset };
};

describe("mutation auth abuse paths", () => {
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

  it("rejects unauthenticated payment confirmation attempts before touching payment state", async () => {
    const { app, getDb } = createMutationHarness();

    const response = await request(app).post("/api/payments/mock/confirm/payment-1").send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated media uploads before parsing or persisting files", async () => {
    const { app, getDb, saveFile, createMediaAsset } = createMutationHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .field("title", "unauthorized")
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: "unauthorized.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
    expect(getDb).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects invalid bearer tokens on media uploads", async () => {
    const { app, getDb, saveFile, createMediaAsset } = createMutationHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set("Authorization", "Bearer not-a-valid-token")
      .field("title", "invalid-token")
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: "invalid-token.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
    expect(getDb).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects authenticated callers without the admin upload policy", async () => {
    const { app, getDb, saveFile, createMediaAsset } = createMutationHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader())
      .field("note", "missing-file");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "forbidden" });
    expect(getDb).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("still reaches validation for authorized admin uploads", async () => {
    const { app } = createMutationHarness();

    const response = await request(app)
      .post("/api/media-assets")
      .set(buildAuthHeader({ sub: "admin-1", email: "admin@example.com", role: "admin" }))
      .field("note", "missing-file");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "validation_error", field: "file" });
  });
});
