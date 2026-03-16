"use strict";

const {
  createRuntimeEnv,
  emitRuntimeEnvWarnings,
} = require("../src/config/runtimeEnv");

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
    expect(resolved.env.instanceMode).toBe("single");
    expect(resolved.trustBoundary.sharedStateReady).toBe(false);
    expect(resolved.trustBoundary.coordinationMode).toBe("process-local-memory");
    expect(resolved.trustBoundary.supportsMultiInstance).toBe(false);
  });

  it("fails clearly when multi-instance mode is declared for process-local trust controls", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      FRONTEND_ORIGIN: "https://officialmerch.tech",
      BACKEND_BASE_URL: "https://api.officialmerch.tech",
      OIDC_APP_BASE_URL: "https://officialmerch.tech",
      JWT_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
      INSTANCE_MODE: "multi",
    });

    expect(resolved.ok).toBe(false);
    expect(resolved.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("INSTANCE_MODE=multi is blocked"),
        expect.stringContaining("Set INSTANCE_MODE=single or unset INSTANCE_MODE"),
      ])
    );
  });

  it("fails invalid instance mode values with a readable config error", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      FRONTEND_ORIGIN: "https://officialmerch.tech",
      BACKEND_BASE_URL: "https://api.officialmerch.tech",
      OIDC_APP_BASE_URL: "https://officialmerch.tech",
      JWT_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
      INSTANCE_MODE: "clustered",
    });

    expect(resolved.ok).toBe(false);
    expect(resolved.errors).toEqual(
      expect.arrayContaining([
        'INSTANCE_MODE must be "single" or "multi" when set.',
      ])
    );
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

  it("accepts alias-only origin inputs while recording deprecation visibility", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      PUBLIC_APP_ORIGIN: "https://officialmerch.tech",
      APP_PUBLIC_URL: "https://officialmerch.tech",
      BACKEND_PUBLIC_URL: "https://api.officialmerch.tech",
      JWT_ACCESS_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.origins.frontendOrigin).toBe("https://officialmerch.tech");
    expect(resolved.origins.backendBaseUrl).toBe("https://api.officialmerch.tech");
    expect(resolved.origins.oidcAppBaseUrl).toBe("https://officialmerch.tech");
    expect(resolved.env.accessTokenSecret).toBe("access-secret");
    expect(resolved.aliasWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "env_alias_used",
          canonicalKey: "OIDC_APP_BASE_URL",
          aliasKey: "APP_PUBLIC_URL",
        }),
      ])
    );
  });

  it("prefers canonical values when aliases are also present with the same value", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      FRONTEND_ORIGIN: "https://officialmerch.tech",
      PUBLIC_APP_ORIGIN: "https://officialmerch.tech",
      BACKEND_BASE_URL: "https://api.officialmerch.tech",
      BACKEND_PUBLIC_URL: "https://api.officialmerch.tech",
      OIDC_APP_BASE_URL: "https://officialmerch.tech",
      APP_PUBLIC_URL: "https://officialmerch.tech",
      JWT_SECRET: "access-secret",
      JWT_ACCESS_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.sources.frontendOrigin).toBe("FRONTEND_ORIGIN");
    expect(resolved.sources.backendBaseUrl).toBe("BACKEND_BASE_URL");
    expect(resolved.sources.oidcAppBaseUrl).toBe("OIDC_APP_BASE_URL");
    expect(resolved.sources.jwtSecret).toBe("JWT_SECRET");
    expect(resolved.aliasWarnings).toEqual([]);
  });

  it("fails clearly when canonical and alias values conflict", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      FRONTEND_ORIGIN: "https://officialmerch.tech",
      PUBLIC_APP_ORIGIN: "https://staging.officialmerch.tech",
      BACKEND_BASE_URL: "https://api.officialmerch.tech",
      OIDC_APP_BASE_URL: "https://officialmerch.tech",
      JWT_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
    });

    expect(resolved.ok).toBe(false);
    expect(resolved.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Conflicting environment values for FRONTEND_ORIGIN"),
      ])
    );
  });

  it("emits one structured startup warning per canonical key when aliases are used", () => {
    const resolved = createRuntimeEnv({
      NODE_ENV: "production",
      APP_ENV: "production",
      PUBLIC_APP_ORIGIN: "https://officialmerch.tech",
      APP_PUBLIC_URL: "https://officialmerch.tech",
      BACKEND_PUBLIC_URL: "https://api.officialmerch.tech",
      JWT_ACCESS_SECRET: "access-secret",
      JWT_REFRESH_SECRET: "refresh-secret",
      OIDC_ENABLED: "false",
    });
    const warn = jest.fn();

    emitRuntimeEnvWarnings(resolved, warn);
    emitRuntimeEnvWarnings(resolved, warn);

    expect(warn).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledWith(
      "[startup.runtime]",
      expect.objectContaining({
        event: "process_local_trust_boundary_controls",
        instanceMode: "single",
        sharedStateReady: false,
        coordinationMode: "process-local-memory",
        supportsMultiInstance: false,
      })
    );
    expect(warn).toHaveBeenCalledWith(
      "[startup.env]",
      expect.objectContaining({
        event: "env_alias_used",
        canonicalKey: "JWT_SECRET",
        aliasKey: "JWT_ACCESS_SECRET",
      })
    );
  });
});
