"use strict";

const { createRuntimeEnv } = require("./runtimeEnv");

const getRuntime = () => createRuntimeEnv(process.env);

const resolveFrontendOrigin = () => getRuntime().origins.frontendOrigin;
const resolveBackendBaseUrl = () => getRuntime().origins.backendBaseUrl;
const frontendOrigin = resolveFrontendOrigin();
const backendBaseUrl = resolveBackendBaseUrl();
const runtimeFlags = getRuntime().flags;
const isProduction = runtimeFlags.isProduction;
const isTest = runtimeFlags.isTest;
const isCi = runtimeFlags.isCi;

const getOriginConfigReadiness = () => {
  return getRuntime().originReadiness;
};

module.exports = {
  isProduction,
  isTest,
  isCi,
  resolveFrontendOrigin,
  resolveBackendBaseUrl,
  frontendOrigin,
  backendBaseUrl,
  getOriginConfigReadiness,
};
