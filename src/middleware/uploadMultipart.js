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

      if (!multipart || multipart.parseError) {
        return res.status(400).json(VALIDATION_ERROR(errorField));
      }

      const filesByField = multipart.filesByField || {};
      const fieldNames = Object.keys(filesByField);
      const unexpectedFileField = fieldNames.find((name) => !fileFieldSet.has(name));
      if (unexpectedFileField) {
        return res.status(400).json(VALIDATION_ERROR(errorField));
      }

      const totalFiles = countFiles(filesByField);
      if (totalFiles !== 1 || totalFiles > maxFileCount) {
        return res.status(400).json(VALIDATION_ERROR(errorField));
      }

      const matchedFields = fileFields.filter((name) => filesByField[name]);
      if (matchedFields.length !== 1) {
        return res.status(400).json(VALIDATION_ERROR(errorField));
      }

      const fileEntry = filesByField[matchedFields[0]];
      if (Array.isArray(fileEntry) ? fileEntry.length !== 1 : !fileEntry) {
        return res.status(400).json(VALIDATION_ERROR(errorField));
      }

      const file = Array.isArray(fileEntry) ? fileEntry[0] : fileEntry;
      if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        return res.status(400).json(VALIDATION_ERROR(errorField));
      }

      if (Number.isFinite(options.maxFileSize) && file.buffer.length > Number(options.maxFileSize)) {
        return res.status(400).json(VALIDATION_ERROR(errorField));
      }

      if (allowedMimeTypes && !allowedMimeTypes.has(file.mimetype)) {
        return res.status(400).json(VALIDATION_ERROR(errorField));
      }

      if (typeof options.validateFile === "function") {
        const isValid = await options.validateFile(file, multipart.fields || {}, req);
        if (!isValid) {
          return res.status(400).json(VALIDATION_ERROR(errorField));
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
