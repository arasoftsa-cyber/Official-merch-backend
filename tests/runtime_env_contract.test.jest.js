"use strict";

const { createRuntimeEnv } = require("../src/config/runtimeEnv");

describe("runtime env contract", () => {
  it("uses safe localhost defaults in development when origin env is unset", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "development",
      JWT_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.origins.frontendOrigin).toBe("http://localhost:5173");
    expect(resolved.origins.backendBaseUrl).toBe("http://localhost:3000");
  });

  it("fails production mode when canonical origins are missing", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      JWT_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
    });

    expect(resolved.ok).toBe(false);
    expect(resolved.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Missing frontend origin"),
        expect.stringContaining("Missing backend base URL"),
      ])
    );
  });

  it("fails production mode when backend origin resolves to localhost", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      FRONTEND_ORIGIN: "https://officialmerch.tech",
      BACKEND_BASE_URL: "http://localhost:3000",
      OIDC_APP_BASE_URL: "https://officialmerch.tech",
      JWT_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
    });

    expect(resolved.ok).toBe(false);
    expect(resolved.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("BACKEND_BASE_URL must not point to localhost in production"),
      ])
    );
  });

  it("normalizes trailing slash for canonical origin values", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      FRONTEND_ORIGIN: "https://officialmerch.tech/",
      BACKEND_BASE_URL: "https://api.officialmerch.tech/",
      OIDC_APP_BASE_URL: "https://officialmerch.tech/",
      JWT_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.origins.frontendOrigin).toBe("https://officialmerch.tech");
    expect(resolved.origins.backendBaseUrl).toBe("https://api.officialmerch.tech");
    expect(resolved.origins.oidcAppBaseUrl).toBe("https://officialmerch.tech");
  });

  it("fails malformed canonical URL values", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      FRONTEND_ORIGIN: "not-a-url",
      BACKEND_BASE_URL: "https://api.officialmerch.tech",
      OIDC_APP_BASE_URL: "https://officialmerch.tech",
      JWT_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
    });

    expect(resolved.ok).toBe(false);
    expect(resolved.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("FRONTEND_ORIGIN must be a valid absolute http(s) origin URL"),
      ])
    );
  });

  it("fails invalid OIDC redirect callback path", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      FRONTEND_ORIGIN: "https://officialmerch.tech",
      BACKEND_BASE_URL: "https://api.officialmerch.tech",
      OIDC_APP_BASE_URL: "https://officialmerch.tech",
      OIDC_REDIRECT_URI: "https://api.officialmerch.tech/auth/callback",
      JWT_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "true",
    });

    expect(resolved.ok).toBe(false);
    expect(resolved.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "OIDC_REDIRECT_URI path must be exactly /api/auth/oidc/google/callback"
        ),
      ])
    );
  });
});
