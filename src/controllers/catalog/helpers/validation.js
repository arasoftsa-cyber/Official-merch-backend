const mapMultipartParseError = (multipart) => {
  if (multipart?.parseError === 'payload_too_large') {
    return { error: 'validation', details: [{ field: 'body', message: 'payload too large' }] };
  }
  if (multipart?.parseError) {
    return { error: 'validation', details: [{ field: 'body', message: 'invalid multipart payload' }] };
  }
  return null;
};

module.exports = { mapMultipartParseError };

