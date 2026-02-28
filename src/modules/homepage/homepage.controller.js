const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  listHomepageBanners,
  createHomepageBanner,
  createHomepageBannerFromStoredPublicUrl,
  updateHomepageBannerSortOrder,
  deleteHomepageBannerLink,
} = require("./homepage.service");
const { DEFAULT_HOMEPAGE_BANNER_SORT_ORDER } = require("./homepage.constants");
const { UPLOADS_DIR } = require("../../config/paths");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PUBLIC_URL_LENGTH = 2048;
const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HOMEPAGE_BANNERS_UPLOAD_DIR = path.join(
  UPLOADS_DIR,
  "media-assets",
  "homepage-banners"
);
const MIME_EXT_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);

const parseSortOrder = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
};

const parseContentDisposition = (line) => {
  const nameMatch = line.match(/name="([^"]+)"/i);
  const filenameMatch = line.match(/filename="([^"]*)"/i);
  return {
    name: nameMatch?.[1] || "",
    filename: filenameMatch?.[1] || "",
  };
};

const splitBufferBy = (buffer, delimiter) => {
  const chunks = [];
  let start = 0;
  while (start <= buffer.length) {
    const idx = buffer.indexOf(delimiter, start);
    if (idx === -1) {
      chunks.push(buffer.subarray(start));
      break;
    }
    chunks.push(buffer.subarray(start, idx));
    start = idx + delimiter.length;
  }
  return chunks;
};

const parseMultipartFormData = async (req) => {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return null;
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    return { fields: {}, file: null, parseError: "missing_boundary" };
  }

  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_MULTIPART_BYTES) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  }).catch((error) => ({ parseError: error.message }));

  if (body?.parseError) {
    return { fields: {}, file: null, parseError: body.parseError };
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const rawParts = splitBufferBy(body, delimiter);
  const fields = {};
  let file = null;

  for (const rawPart of rawParts) {
    if (!rawPart || rawPart.length === 0) continue;
    let part = rawPart;
    if (part.subarray(0, 2).toString() === "\r\n") {
      part = part.subarray(2);
    }
    if (part.length === 0) continue;
    if (part.subarray(0, 2).toString() === "--") continue;

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) continue;
    const headerText = part.subarray(0, headerEnd).toString("utf8");
    let content = part.subarray(headerEnd + 4);
    if (content.subarray(content.length - 2).toString() === "\r\n") {
      content = content.subarray(0, content.length - 2);
    }

    const dispositionLine = headerText
      .split("\r\n")
      .find((line) => /^content-disposition:/i.test(line));
    if (!dispositionLine) continue;
    const { name, filename } = parseContentDisposition(dispositionLine);
    if (!name) continue;

    const contentTypeLine = headerText
      .split("\r\n")
      .find((line) => /^content-type:/i.test(line));
    const mimeType = contentTypeLine
      ? contentTypeLine.split(":")[1]?.trim() || "application/octet-stream"
      : "application/octet-stream";

    if (filename) {
      file = {
        fieldname: name,
        originalname: filename,
        mimetype: mimeType.toLowerCase(),
        buffer: content,
      };
      continue;
    }

    fields[name] = content.toString("utf8");
  }

  return { fields, file };
};

const saveHomepageBannerImage = async (file) => {
  fs.mkdirSync(HOMEPAGE_BANNERS_UPLOAD_DIR, { recursive: true });
  const ext = MIME_EXT_BY_TYPE[file.mimetype] || "";
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const absolutePath = path.join(HOMEPAGE_BANNERS_UPLOAD_DIR, filename);
  await fs.promises.writeFile(absolutePath, file.buffer);
  return `/uploads/media-assets/homepage-banners/${filename}`;
};

const getHomepageBanners = async (req, res, next) => {
  try {
    const banners = await listHomepageBanners();
    return res.status(200).json({ banners });
  } catch (err) {
    return next(err);
  }
};

const createHomepageBannerHandler = async (req, res, next) => {
  try {
    const body = req.body || {};
    const publicUrlRaw = String(body.public_url || "").trim();
    if (!publicUrlRaw) {
      return res.status(400).json({ error: "validation_error", field: "public_url" });
    }
    if (publicUrlRaw.length > MAX_PUBLIC_URL_LENGTH) {
      return res.status(400).json({ error: "validation_error", field: "public_url" });
    }

    const parsedSortOrder =
      body.sort_order === undefined
        ? DEFAULT_HOMEPAGE_BANNER_SORT_ORDER
        : parseSortOrder(body.sort_order);
    if (!Number.isInteger(parsedSortOrder)) {
      return res.status(400).json({ error: "validation_error", field: "sort_order" });
    }

    const banner = await createHomepageBanner({
      publicUrl: publicUrlRaw,
      sortOrder: parsedSortOrder,
    });

    return res.status(201).json({ banner });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "conflict" });
    }
    return next(err);
  }
};

const patchHomepageBannerHandler = async (req, res, next) => {
  try {
    const linkId = String(req.params?.linkId || "").trim();
    if (!isUuid(linkId)) {
      return res.status(400).json({ error: "validation_error", field: "linkId" });
    }

    const body = req.body || {};
    const parsedSortOrder = parseSortOrder(body.sort_order);
    if (!Number.isInteger(parsedSortOrder)) {
      return res.status(400).json({ error: "validation_error", field: "sort_order" });
    }

    const updated = await updateHomepageBannerSortOrder({
      linkId,
      sortOrder: parsedSortOrder,
    });

    if (!updated) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.status(200).json({ banner: updated });
  } catch (err) {
    return next(err);
  }
};

const deleteHomepageBannerHandler = async (req, res, next) => {
  try {
    const linkId = String(req.params?.linkId || "").trim();
    if (!isUuid(linkId)) {
      return res.status(400).json({ error: "validation_error", field: "linkId" });
    }

    const deleted = await deleteHomepageBannerLink({ linkId });
    if (!deleted) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
};

const uploadHomepageBannerHandler = async (req, res, next) => {
  try {
    const multipart = await parseMultipartFormData(req);
    if (!multipart) {
      return res.status(400).json({ error: "validation_error", field: "image" });
    }
    if (multipart.parseError === "payload_too_large") {
      return res.status(400).json({ error: "validation_error", field: "image" });
    }
    if (multipart.parseError) {
      return res.status(400).json({ error: "validation_error", field: "image" });
    }

    const upload = multipart.file;
    if (!upload || upload.fieldname !== "image" || !upload.buffer?.length) {
      return res.status(400).json({ error: "validation_error", field: "image" });
    }
    if (upload.buffer.length > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: "validation_error", field: "image" });
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(upload.mimetype)) {
      return res.status(400).json({ error: "validation_error", field: "image" });
    }

    const publicUrl = await saveHomepageBannerImage(upload);
    const banner = await createHomepageBannerFromStoredPublicUrl({
      publicUrl,
      sortOrder: DEFAULT_HOMEPAGE_BANNER_SORT_ORDER,
    });

    return res.status(201).json({ banner });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "conflict" });
    }
    return next(err);
  }
};

module.exports = {
  getHomepageBanners,
  createHomepageBannerHandler,
  patchHomepageBannerHandler,
  deleteHomepageBannerHandler,
  uploadHomepageBannerHandler,
};
