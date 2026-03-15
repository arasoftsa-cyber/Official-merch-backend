process.env.NODE_ENV = "test";

const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { silenceTestLogs } = require("./helpers/logging");

const ARTIST_ACCESS_ROUTE_MODULE_PATH = path.resolve(
  __dirname,
  "../src/routes/artistAccessRequests.routes.js"
);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);

const buildPngBuffer = (size = PNG_SIGNATURE.length) => {
  const buffer = Buffer.alloc(size, 0);
  PNG_SIGNATURE.copy(buffer, 0);
  return buffer;
};

const buildJpegBuffer = (size = JPEG_SIGNATURE.length) => {
  const buffer = Buffer.alloc(size, 0);
  JPEG_SIGNATURE.copy(buffer, 0);
  return buffer;
};

const buildPayload = () => ({
  artist_name: "Upload Artist",
  handle: "upload-artist",
  email: "upload-artist@example.com",
  phone: "+49 123 4567",
  requested_plan_type: "basic",
});

const createRouteHarness = () => {
  const submitArtistAccessRequest = jest.fn().mockResolvedValue({
    request_id: "request-1",
    created_at: "2026-03-15T00:00:00.000Z",
  });
  const checkArtistAccessAvailability = jest.fn();

  jest.resetModules();
  jest.doMock("../src/services/artistAccessRequests.service.js", () => {
    const actual = jest.requireActual("../src/services/artistAccessRequests.service.js");
    return {
      ...actual,
      submitArtistAccessRequest,
      checkArtistAccessAvailability,
    };
  });

  const router = require(ARTIST_ACCESS_ROUTE_MODULE_PATH);
  const app = express();
  app.use(express.json());
  app.use("/api/artist-access-requests", router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: "internal_server_error" }));

  return { app, submitArtistAccessRequest };
};

describe("artist access request upload hardening", () => {
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

  it("accepts canonical multipart submissions with a valid profile photo", async () => {
    const { app, submitArtistAccessRequest } = createRouteHarness();

    const response = await request(app)
      .post("/api/artist-access-requests")
      .field("artist_name", buildPayload().artist_name)
      .field("handle", buildPayload().handle)
      .field("email", buildPayload().email)
      .field("phone", buildPayload().phone)
      .field("requested_plan_type", buildPayload().requested_plan_type)
      .attach("profile_photo", buildJpegBuffer(), {
        filename: "profile.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ok: true,
      request_id: "request-1",
      created_at: "2026-03-15T00:00:00.000Z",
    });
    expect(submitArtistAccessRequest).toHaveBeenCalledWith({
      rawBody: expect.objectContaining({
        artist_name: "Upload Artist",
        handle: "upload-artist",
        email: "upload-artist@example.com",
        phone: "491234567",
        requested_plan_type: "basic",
      }),
      file: expect.objectContaining({
        fieldname: "profile_photo",
        mimetype: "image/jpeg",
        originalname: "profile.jpg",
      }),
    });
  });

  it("rejects wrong file field names", async () => {
    const { app, submitArtistAccessRequest } = createRouteHarness();

    const response = await request(app)
      .post("/api/artist-access-requests")
      .field("artist_name", buildPayload().artist_name)
      .field("handle", buildPayload().handle)
      .field("email", buildPayload().email)
      .field("phone", buildPayload().phone)
      .field("requested_plan_type", buildPayload().requested_plan_type)
      .attach("avatar", buildPngBuffer(), {
        filename: "avatar.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "validation",
      details: [{ field: "profile_photo", message: "profile_photo is invalid" }],
    });
    expect(submitArtistAccessRequest).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types", async () => {
    const { app, submitArtistAccessRequest } = createRouteHarness();

    const response = await request(app)
      .post("/api/artist-access-requests")
      .field("artist_name", buildPayload().artist_name)
      .field("handle", buildPayload().handle)
      .field("email", buildPayload().email)
      .field("phone", buildPayload().phone)
      .field("requested_plan_type", buildPayload().requested_plan_type)
      .attach("profile_photo", Buffer.from("plain text upload"), {
        filename: "note.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "validation",
      details: [{ field: "profile_photo", message: "profile_photo is invalid" }],
    });
    expect(submitArtistAccessRequest).not.toHaveBeenCalled();
  });

  it("rejects empty files safely", async () => {
    const { app, submitArtistAccessRequest } = createRouteHarness();

    const response = await request(app)
      .post("/api/artist-access-requests")
      .field("artist_name", buildPayload().artist_name)
      .field("handle", buildPayload().handle)
      .field("email", buildPayload().email)
      .field("phone", buildPayload().phone)
      .field("requested_plan_type", buildPayload().requested_plan_type)
      .attach("profile_photo", Buffer.alloc(0), {
        filename: "empty.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "validation",
      details: [{ field: "profile_photo", message: "profile_photo is invalid" }],
    });
    expect(submitArtistAccessRequest).not.toHaveBeenCalled();
  });

  it("rejects malformed multipart payloads with a controlled validation response", async () => {
    const { app, submitArtistAccessRequest } = createRouteHarness();

    const response = await request(app)
      .post("/api/artist-access-requests")
      .set("Content-Type", "multipart/form-data; boundary=BrokenBoundary")
      .send(
        "--BrokenBoundary\r\n" +
          'Content-Disposition: form-data; name="profile_photo"; filename="broken.png"\r\n' +
          "Content-Type: image/png\r\n\r\n"
      );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "validation",
      details: [{ field: "body", message: "invalid multipart payload" }],
    });
    expect(submitArtistAccessRequest).not.toHaveBeenCalled();
  });

  it("rejects multiple uploaded files", async () => {
    const { app, submitArtistAccessRequest } = createRouteHarness();

    const response = await request(app)
      .post("/api/artist-access-requests")
      .field("artist_name", buildPayload().artist_name)
      .field("handle", buildPayload().handle)
      .field("email", buildPayload().email)
      .field("phone", buildPayload().phone)
      .field("requested_plan_type", buildPayload().requested_plan_type)
      .attach("profile_photo", buildPngBuffer(), {
        filename: "photo-1.png",
        contentType: "image/png",
      })
      .attach("profilePhoto", buildJpegBuffer(), {
        filename: "photo-2.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "validation",
      details: [{ field: "profile_photo", message: "profile_photo is invalid" }],
    });
    expect(submitArtistAccessRequest).not.toHaveBeenCalled();
  });

  it("rejects oversized files", async () => {
    const { app, submitArtistAccessRequest } = createRouteHarness();

    const response = await request(app)
      .post("/api/artist-access-requests")
      .field("artist_name", buildPayload().artist_name)
      .field("handle", buildPayload().handle)
      .field("email", buildPayload().email)
      .field("phone", buildPayload().phone)
      .field("requested_plan_type", buildPayload().requested_plan_type)
      .attach("profile_photo", buildPngBuffer(1024 * 1024 + 1), {
        filename: "large.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "validation",
      details: [{ field: "profile_photo", message: "profile_photo is invalid" }],
    });
    expect(submitArtistAccessRequest).not.toHaveBeenCalled();
  });

  it("still accepts non-file submissions when the photo is omitted", async () => {
    const { app, submitArtistAccessRequest } = createRouteHarness();

    const response = await request(app)
      .post("/api/artist-access-requests")
      .send(buildPayload());

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ok: true,
      request_id: "request-1",
      created_at: "2026-03-15T00:00:00.000Z",
    });
    expect(submitArtistAccessRequest).toHaveBeenCalledWith({
      rawBody: expect.objectContaining({
        artist_name: "Upload Artist",
        handle: "upload-artist",
        email: "upload-artist@example.com",
        phone: "491234567",
        requested_plan_type: "basic",
      }),
      file: null,
    });
  });
});
