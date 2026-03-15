# 05 Findings And Priority Fixes

## Findings Register

### High

#### Object storage mode is selectable but not operational

Files:

- `src/storage/objectStorageProvider.js`
- `src/storage/index.js`
- `src/config/runtimeEnv.js`

What is implemented:

- `STORAGE_PROVIDER=object` is accepted when required env is present.
- Public URL generation and object-key normalization are implemented.

Why this is risky:

- `saveFile()` and `deleteFile()` throw `object_storage_provider_not_implemented`.
- Production can therefore be configured into a mode that passes env validation but fails on real uploads.

#### Abuse controls are single-process only

Files:

- `src/core/http/rateLimit.js`
- `src/core/http/accountLockout.js`
- `src/core/http/spamDetection.js`
- `src/services/oidc.service.js`

What is implemented:

- Rate limiting, account lockout, order spam guard, and OIDC exchange-code replay prevention.

Why this is risky:

- All of these controls are in-memory maps.
- They reset on restart and do not coordinate across multiple instances.

### Medium

#### Health/readiness is stricter than actual service behavior

Files:

- `src/routes/health.routes.js`
- `src/services/email.service.js`
- `app.js`

What is implemented:

- Health returns 503 when DB, origin config, or email config are not ready.
- Most email sends are best-effort and do not fail the underlying request.

Why this is risky:

- Deployments can be marked degraded even when the core commerce API remains usable.
- This is operationally inconsistent and can create false negatives in uptime automation.

#### Cookie refresh support is partial only

Files:

- `src/services/auth.service.js`
- `app.js`

What is implemented:

- Refresh token extraction checks request body, bearer token, and cookies.

Why this is risky:

- The app does not register cookie parsing middleware, so cookie-based refresh is not actually available.
- This is not a direct vulnerability, but it is a misleading partial contract.

#### Route authorization style is mixed

Files:

- `src/routes/*.js`
- `src/core/http/policy.middleware.js`
- `src/core/rbac/*.js`

What is implemented:

- Policy middleware exists and works.
- Many routes also use route-local role checks.

Why this is risky:

- Mixed authorization patterns make it easier to introduce inconsistent protections on future endpoints.

#### Startup contains development-only data mutation

Files:

- `app.js`

What is implemented:

- Dev startup normalizes seeded user roles and seeds artist access requests when empty.

Why this is risky:

- This is safe only because it is gated to development, but it adds hidden side effects to process start and complicates reproducibility.

### Low

#### Backup automation is one-way only

Files:

- `scripts/backup.js`
- `backups/`

What is implemented:

- `pg_dump` backup generation.

Missing:

- restore automation
- retention policy
- integrity verification
- encryption/offsite handling

#### Logging is only partially structured

Files:

- `src/core/http/logger.js`
- `app.js`

What is implemented:

- request logs are JSON
- many operational/error logs are plain console output

Why this is risky:

- Correlating incidents across startup, background, and request failures will remain manual.

## Quick Wins / Priority Fixes

1. Either implement the object-storage provider fully or reject `STORAGE_PROVIDER=object` at startup until upload and delete operations exist.
2. Move rate limiting, lockout, OIDC replay state, and spam guards to shared persistent storage for multi-instance deployments.
3. Split health semantics into:
   - liveness / process healthy
   - readiness / critical dependencies healthy
   and decide whether email config is truly a blocking dependency.
4. Add graceful shutdown for:
   - HTTP server
   - Knex pool
   - fatal process events
5. Standardize route authorization on `requirePolicy()` or a single documented pattern per route family.
6. Remove or isolate development data seeding from `app.js` startup into explicit scripts.
7. Add at least one real integration lane that runs against PostgreSQL instead of relying mainly on mocked query-builder behavior.
