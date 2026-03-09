"use strict";

const request = require("supertest");

const normalizeSetCookieHeader = (loginResponse) => {
  const setCookie = loginResponse?.headers?.["set-cookie"];
  if (!Array.isArray(setCookie)) return [];
  return setCookie.map((cookieValue) => String(cookieValue).split(";")[0]).filter(Boolean);
};

const extractAuthHeaders = (loginResponse) => {
  const headers = {};
  const cookieParts = normalizeSetCookieHeader(loginResponse);
  if (cookieParts.length > 0) {
    headers.Cookie = cookieParts.join("; ");
  }
  if (loginResponse?.body?.accessToken) {
    headers.Authorization = `Bearer ${loginResponse.body.accessToken}`;
  }
  return headers;
};

const createAuthenticatedAgent = async (app, credentials, loginPath = "/api/auth/login") => {
  const agent = request.agent(app);
  const loginResponse = await agent.post(loginPath).send(credentials);
  return {
    agent,
    loginResponse,
    authHeaders: extractAuthHeaders(loginResponse),
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
