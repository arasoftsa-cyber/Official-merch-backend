"use strict";

const { unwrapArrayBody } = require("./response");

const assertAliasParity = async ({
  agent,
  canonicalPath,
  aliasPath,
  expectedStatus = 200,
  unwrapKeys = ["items", "leads", "data", "results"],
}) => {
  const canonicalResponse = await agent.get(canonicalPath);
  const aliasResponse = await agent.get(aliasPath);

  expect(canonicalResponse.status).toBe(expectedStatus);
  expect(aliasResponse.status).toBe(expectedStatus);

  const canonicalBody = unwrapArrayBody(canonicalResponse, unwrapKeys);
  const aliasBody = unwrapArrayBody(aliasResponse, unwrapKeys);

  return {
    canonicalResponse,
    aliasResponse,
    canonicalBody,
    aliasBody,
  };
};

module.exports = {
  assertAliasParity,
};
