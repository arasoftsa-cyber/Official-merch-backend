const express = require("express");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../../config/db");
const { UPLOADS_DIR } = require("../../config/paths");
const { toAbsolutePublicUrl } = require("../../utils/publicUrl");

const router = express.Router();
const UPLOAD_DIR = path.join(UPLOADS_DIR, "media-assets");

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
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

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
        mimetype: mimeType,
        buffer: content,
      };
      continue;
    }

    fields[name] = content.toString("utf8");
  }

  return { fields, file };
};

const sanitizeExt = (filename) => {
  const originalExt = path.extname(filename || "").slice(0, 12);
  return /^[.][a-z0-9]+$/i.test(originalExt) ? originalExt.toLowerCase() : "";
};

const saveUploadedFile = async (file) => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ext = sanitizeExt(file.originalname);
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const absolutePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(absolutePath, file.buffer);
  return `/uploads/media-assets/${filename}`;
};

router.post("/", async (req, res) => {
  try {
    const multipart = await parseMultipartFormData(req);
    if (!multipart || multipart?.parseError) {
      return res.status(400).json({ error: "validation_error", field: "file" });
    }

    const upload = multipart.file;
    if (!upload || !upload.buffer?.length) {
      return res.status(400).json({ error: "validation_error", field: "file" });
    }

    const relativeUrl = await saveUploadedFile(upload);
    const publicUrl = toAbsolutePublicUrl(relativeUrl);
    const id = randomUUID();

    const db = getDb();
    await db("media_assets").insert({
      id,
      public_url: publicUrl,
      created_at: db.fn.now(),
    });

    return res.status(201).json({ id, publicUrl });
  } catch (err) {
    console.error("[media-assets] upload failed", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

module.exports = router;
