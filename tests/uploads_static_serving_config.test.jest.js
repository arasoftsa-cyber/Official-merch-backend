"use strict";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { UPLOADS_DIR } = require("../src/core/config/paths");

describe("uploads static serving strategy", () => {
  const ORIGINAL_ENV = process.env;
  const fixtureName = `__uploads-static-test-${Date.now()}.txt`;
  const fixturePath = path.join(UPLOADS_DIR, fixtureName);

  beforeAll(() => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(fixturePath, "ok", "utf8");
  });

  afterAll(() => {
    try {
      fs.unlinkSync(fixturePath);
    } catch {}
    process.env = ORIGINAL_ENV;
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("serves /uploads in local/default mode", async () => {
    delete process.env.STORAGE_PROVIDER;
    delete process.env.ENABLE_LEGACY_UPLOADS_STATIC;
    const app = require("../app");
    const res = await request(app).get(`/uploads/${fixtureName}`);
    expect(res.status).toBe(200);
    expect(String(res.text || "")).toContain("ok");
  });

  it("disables app /uploads static serving when STORAGE_PROVIDER=object", async () => {
    process.env.STORAGE_PROVIDER = "object";
    process.env.OBJECT_STORAGE_BUCKET = "media-bucket";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    delete process.env.ENABLE_LEGACY_UPLOADS_STATIC;
    const app = require("../app");
    const res = await request(app).get(`/uploads/${fixtureName}`);
    expect(res.status).toBe(404);
  });

  it("allows explicit legacy static serving override in object mode", async () => {
    process.env.STORAGE_PROVIDER = "object";
    process.env.OBJECT_STORAGE_BUCKET = "media-bucket";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.ENABLE_LEGACY_UPLOADS_STATIC = "true";
    const app = require("../app");
    const res = await request(app).get(`/uploads/${fixtureName}`);
    expect(res.status).toBe(200);
    expect(String(res.text || "")).toContain("ok");
  });
});
