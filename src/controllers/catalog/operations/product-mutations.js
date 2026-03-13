const { parseMultipartFormData } = require("../multipart");
const { mapMultipartParseError } = require("../helpers/validation");
const {
  isHttpError,
  parseMultipartPayload,
} = require("./product-mutations.validators");
const {
  createProductOperation,
  updateProductOperation,
  updateProductPhotosOperation,
} = require("./product-mutations.service");
const {
  toCreateNewMerchResponse,
  toCreateProductResponse,
  toUpdateProductResponse,
  toUpdateProductPhotosResponse,
} = require("./product-mutations.serializers");

const createProduct = async (req, res) => {
  const multipart = await parseMultipartFormData(req);
  const multipartError = mapMultipartParseError(multipart);
  if (multipartError) return res.status(400).json(multipartError);

  const { body, filesByField } = parseMultipartPayload(req, multipart);
  const operation = await createProductOperation({
    user: req.user,
    body,
    filesByField,
    fallbackBody: req.body || {},
    originalUrl: req.originalUrl,
  });
  if (isHttpError(operation)) {
    return res.status(operation.status).json(operation.payload);
  }

  if (operation.kind === "new_merch") {
    return res.status(201).json(toCreateNewMerchResponse(operation.created));
  }
  return res.status(201).json(
    toCreateProductResponse({
      productRow: operation.productRow,
      variantRow: operation.variantRow,
      listingPhotoUrls: operation.listingPhotoUrls,
    })
  );
};

const updateProduct = async (req, res) => {
  const operation = await updateProductOperation({
    user: req.user,
    id: req.params?.id,
    payload: req.body || {},
  });
  if (isHttpError(operation)) {
    return res.status(operation.status).json(operation.payload);
  }
  return res.json(
    toUpdateProductResponse({
      productRow: operation.productRow,
      primaryVariant: operation.primaryVariant,
    })
  );
};

const updateProductPhotos = async (req, res) => {
  const multipart = await parseMultipartFormData(req);
  const multipartError = mapMultipartParseError(multipart);
  if (multipartError) return res.status(400).json(multipartError);

  const { filesByField } = parseMultipartPayload(req, multipart);
  const operation = await updateProductPhotosOperation({
    user: req.user,
    id: req.params?.id,
    filesByField,
  });
  if (isHttpError(operation)) {
    return res.status(operation.status).json(operation.payload);
  }
  return res.json(
    toUpdateProductPhotosResponse({
      productId: operation.productId,
      listingPhotoUrls: operation.listingPhotoUrls,
    })
  );
};

module.exports = {
  createProduct,
  updateProduct,
  updateProductPhotos,
};
