"use strict";

const envLoader = require("../src/core/config/env");
const { createRuntimeEnv, applyRuntimeEnvCompatibility } = require("../src/config/runtimeEnv");

const args = process.argv.slice(2);
const forceProduction =
  args.includes("--production") || args.includes("--mode=production");

const mergedEnv = {
  ...process.env,
  ...(forceProduction ? { NODE_ENV: "production", APP_ENV: "production" } : {}),
};

const runtimeEnv = createRuntimeEnv(mergedEnv);

if (!runtimeEnv.ok) {
  console.error("[env:check] invalid backend environment contract");
  runtimeEnv.errors.forEach((error, index) => {
    console.error(`  ${index + 1}. ${error}`);
  });
  process.exit(1);
}

applyRuntimeEnvCompatibility(runtimeEnv);

const envDiagnostics =
  typeof envLoader.getEnvDiagnostics === "function"
    ? envLoader.getEnvDiagnostics()
    : { loadedFiles: [] };

console.log("[env:check] ok", {
  nodeEnv: runtimeEnv.flags.nodeEnv,
  isProduction: runtimeEnv.flags.isProduction,
  frontendOrigin: runtimeEnv.origins.frontendOrigin,
  backendBaseUrl: runtimeEnv.origins.backendBaseUrl,
  oidcAppBaseUrl: runtimeEnv.origins.oidcAppBaseUrl || null,
  storageProvider: runtimeEnv.env.storageProvider,
  warnings: runtimeEnv.warnings,
  envFiles: envDiagnostics.loadedFiles,
});
