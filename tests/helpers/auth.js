"use strict";

const request = require("supertest");

const extractAuthHeaders = (loginResponse) => {
  const headers = {};
  if (loginResponse?.body?.accessToken) {
    headers.Authorization = `Bearer ${loginResponse.body.accessToken}`;
  }
  return headers;
};

const withAuthHeaders = (agent, authHeaders) => {
  const wrapped = Object.create(agent);
  const methods = ["get", "post", "put", "patch", "delete", "head", "options"];

  for (const method of methods) {
    if (typeof agent[method] !== "function") continue;
    wrapped[method] = (...args) => {
      const req = agent[method](...args);
      if (authHeaders.Authorization) {
        req.set("Authorization", authHeaders.Authorization);
      }
      return req;
    };
  }

  return wrapped;
};

const createAuthenticatedAgent = async (app, credentials, loginPath = "/api/auth/login") => {
  const agent = request.agent(app);
  const loginResponse = await agent.post(loginPath).send(credentials);
  const authHeaders = extractAuthHeaders(loginResponse);
  return {
    agent: withAuthHeaders(agent, authHeaders),
    loginResponse,
    authHeaders,
  };
};

const createAuthenticatedHeaders = async (
  app,
  credentials,
  loginPath = "/api/auth/login"
) => {
  const loginResponse = await request(app).post(loginPath).send(credentials);
  return {
    loginResponse,
    headers: extractAuthHeaders(loginResponse),
  };
};

module.exports = {
  createAuthenticatedAgent,
  createAuthenticatedHeaders,
  extractAuthHeaders,
};
