const { parseMultipartFormData } = require("../controllers/catalog/multipart");

const VALIDATION_ERROR = (field = "file") => ({
  error: "validation_error",
  field,
});

const toUniqueNames = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

const countFiles = (filesByField) =>
  Object.values(filesByField || {}).reduce((total, entry) => {
    if (!entry) return total;
    return total + (Array.isArray(entry) ? entry.length : 1);
  }, 0);

const getErrorPayload = (options, field, req, reason) => {
  if (typeof options.buildErrorPayload === "function") {
    return options.buildErrorPayload({ field, req, reason });
  }
  return VALIDATION_ERROR(field);
};

const createMultipartUploadMiddleware = (options = {}) => {
  const fileFields = toUniqueNames(options.fileFields || ["file"]);
  const fileFieldSet = new Set(fileFields);
  const allowedMimeTypes = options.allowedMimeTypes ? new Set(options.allowedMimeTypes) : null;
  const maxFileCount =
    Number.isInteger(options.maxFileCount) && options.maxFileCount > 0
      ? options.maxFileCount
      : 1;
  const errorField = String(options.errorField || fileFields[0] || "file");
  const attachKey = String(options.attachKey || "uploadMultipart");

  return async (req, res, next) => {
    try {
      const multipart = await parseMultipartFormData(req, {
        maxBytes: options.maxBytes,
      });

      if (!multipart) {
        if (options.optionalFile) {
          req[attachKey] = {
            fields: req.body || {},
            filesByField: {},
            file: null,
            fileField: null,
          };
          return next();
        }
        return res.status(400).json(getErrorPayload(options, errorField, req, "missing_multipart"));
      }

      if (multipart.parseError) {
        return res.status(400).json(getErrorPayload(options, errorField, req, "parse_error"));
      }

      const filesByField = multipart.filesByField || {};
      const fieldNames = Object.keys(filesByField);
      const unexpectedFileField = fieldNames.find((name) => !fileFieldSet.has(name));
      if (unexpectedFileField) {
        return res.status(400).json(getErrorPayload(options, errorField, req, "unexpected_field"));
      }

      const totalFiles = countFiles(filesByField);
      if (options.optionalFile && totalFiles === 0) {
        req[attachKey] = {
          fields: multipart.fields || {},
          filesByField,
          file: null,
          fileField: null,
        };
        return next();
      }

      if (totalFiles !== 1 || totalFiles > maxFileCount) {
        return res.status(400).json(getErrorPayload(options, errorField, req, "file_count"));
      }

      const matchedFields = fileFields.filter((name) => filesByField[name]);
      if (matchedFields.length !== 1) {
        return res.status(400).json(getErrorPayload(options, errorField, req, "file_field"));
      }

      const fileEntry = filesByField[matchedFields[0]];
      if (Array.isArray(fileEntry) ? fileEntry.length !== 1 : !fileEntry) {
        return res.status(400).json(getErrorPayload(options, errorField, req, "file_field"));
      }

      const file = Array.isArray(fileEntry) ? fileEntry[0] : fileEntry;
      if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        return res.status(400).json(getErrorPayload(options, errorField, req, "empty_file"));
      }

      if (Number.isFinite(options.maxFileSize) && file.buffer.length > Number(options.maxFileSize)) {
        return res.status(400).json(getErrorPayload(options, errorField, req, "file_size"));
      }

      if (allowedMimeTypes && !allowedMimeTypes.has(file.mimetype)) {
        return res.status(400).json(getErrorPayload(options, errorField, req, "mime_type"));
      }

      if (typeof options.validateFile === "function") {
        const isValid = await options.validateFile(file, multipart.fields || {}, req);
        if (!isValid) {
          return res.status(400).json(getErrorPayload(options, errorField, req, "file_validation"));
        }
      }

      req[attachKey] = {
        fields: multipart.fields || {},
        filesByField,
        file,
        fileField: matchedFields[0],
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = {
  createMultipartUploadMiddleware,
  VALIDATION_ERROR,
};
