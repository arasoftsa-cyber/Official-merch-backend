const MAX_MULTIPART_BYTES = 15 * 1024 * 1024;

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
  if (!contentType.toLowerCase().includes("multipart/form-data")) return null;

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return { fields: {}, filesByField: {}, parseError: "missing_boundary" };

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

  if (body?.parseError) return { fields: {}, filesByField: {}, parseError: body.parseError };

  const delimiter = Buffer.from(`--${boundary}`);
  const rawParts = splitBufferBy(body, delimiter);
  const fields = {};
  const filesByField = {};

  for (const rawPart of rawParts) {
    if (!rawPart || rawPart.length === 0) continue;

    let part = rawPart;
    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
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
      .find((entry) => /^content-disposition:/i.test(entry));
    if (!dispositionLine) continue;

    const { name, filename } = parseContentDisposition(dispositionLine);
    if (!name) continue;

    const contentTypeLine = headerText
      .split("\r\n")
      .find((entry) => /^content-type:/i.test(entry));
    const mimeType = contentTypeLine
      ? contentTypeLine.split(":")[1]?.trim() || "application/octet-stream"
      : "application/octet-stream";

    if (filename) {
      const filePayload = {
        fieldname: name,
        originalname: filename,
        mimetype: mimeType,
        buffer: content,
      };
      const existing = filesByField[name];
      if (!existing) {
        filesByField[name] = filePayload;
      } else if (Array.isArray(existing)) {
        existing.push(filePayload);
      } else {
        filesByField[name] = [existing, filePayload];
      }
      continue;
    }

    fields[name] = content.toString("utf8");
  }

  return { fields, filesByField };
};

module.exports = {
  parseMultipartFormData,
};
