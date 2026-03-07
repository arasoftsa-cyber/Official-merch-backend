const express = require("express");
const { trim, submitArtistAccessRequest, checkArtistAccessAvailability } = require("./artistAccessRequests.service");

const router = express.Router();
const MAX_MULTIPART_BYTES = 2 * 1024 * 1024;

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
        mimetype: mimeType,
        buffer: content,
      };
      continue;
    }

    fields[name] = content.toString("utf8");
  }

  return { fields, file };
};

router.get("/check", async (req, res) => {
  try {
    const handle = trim(req.query?.handle).toLowerCase().replace(/^@+/, "");
    const email = trim(req.query?.email).toLowerCase();
    const phone = trim(req.query?.phone).replace(/\D+/g, "");

    let field = null;
    let value = "";
    if (handle) {
      field = "handle";
      value = handle;
    } else if (email) {
      field = "email";
      value = email;
    } else if (phone) {
      field = "phone";
      value = phone;
    }

    const result = await checkArtistAccessAvailability({ field, value });
    return res.status(200).json(result);
  } catch (error) {
    if (error?.code === "validation") {
      return res.status(400).json({ error: "validation", details: error.details || [] });
    }
    return res.status(500).json({ error: "internal_server_error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const multipart = await parseMultipartFormData(req);
    if (multipart?.parseError === "payload_too_large") {
      return res
        .status(400)
        .json({ error: "validation", details: [{ field: "body", message: "payload too large" }] });
    }
    if (multipart?.parseError) {
      return res.status(400).json({
        error: "validation",
        details: [{ field: "body", message: "invalid multipart payload" }],
      });
    }

    const rawBody = multipart?.fields || req.body || {};
    const result = await submitArtistAccessRequest({ rawBody, file: multipart?.file || null });
    return res.status(201).json({ ok: true, request_id: result.request_id, created_at: result.created_at });
  } catch (error) {
    if (error?.code === "validation") {
      return res.status(400).json({ error: "validation", details: error.details || [] });
    }
    if (error?.code === "conflict") {
      return res.status(409).json({ error: "conflict", field: error.field || "email" });
    }
    console.error(error);
    return res.status(500).json({ error: "internal_server_error" });
  }
});

module.exports = router;
