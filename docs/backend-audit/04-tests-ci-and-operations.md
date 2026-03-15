# 04 Tests CI And Operations

## Test Structure

Implemented:

- Jest is the backend test runner.
- Tests are concentrated in `tests/*.test.jest.js`.
- Coverage areas include:
  - auth login and RBAC
  - OIDC config and redirect handling
  - password reset
  - refresh token lifecycle
  - drops read/admin lifecycle
  - orders lifecycle
  - artist access request submission/review
  - storage selection and upload scan scaffolding
  - env contract
  - email service/template rendering
  - smoke critical path

Partially implemented:

- Most tests are contract/unit style with mocked DB and mocked integrations.
- There is no evidence of a real integration suite against a live PostgreSQL instance in the default Jest lane.

Risky / needs hardening:

- The test surface is broad, but a large share of confidence comes from mocked query builders and in-memory harnesses rather than end-to-end infra validation.

## CI And Validation Scripts

Implemented:

- `npm run env:check`
- `npm run env:check:prod`
- `npm run test:backend:local`
- `npm run test:backend:prod-config`
- `npm run ci:backend`
- `npm run ci:backend:local`
- `npm run ci:config:prod`
- `npm run ci:aggregate`
- `npm run ci:aggregate:prod-config`
- compatibility aliases:
  - `npm run ci:local` -> backend authoritative local lane
  - `npm run ci:prod-config` -> backend authoritative production-config lane
- `scripts/ci_backend_local.ps1` runs:
  - migrations
  - UI smoke seed
  - Jest suite
- `scripts/ci_prod_config_check.ps1` runs:
  - production env contract checks
  - backend production-config Jest tests
- `scripts/ci_check.ps1` runs:
  - backend authoritative local lane
  - frontend aggregate validation
- `scripts/ci_prod_config_aggregate.ps1` runs:
  - backend authoritative production-config lane
  - frontend production-config validation

Partially implemented:

- CI orchestration is Windows PowerShell oriented.
- Local CI script assumes migration access and seed script availability.
- Aggregate CI remains useful for cross-repo validation, but it is no longer the backend health signal.

Risky / needs hardening:

- There is no repo-local containerized test harness or portable shell-based CI script for non-Windows agents.
- The backend prod-config lane validates configuration correctness, but not a true production-like runtime boot with real integrations.

## Logging And Observability

Implemented:

- Every request is logged as a JSON line with:
  - timestamp
  - method
  - path
  - requestId
  - status
  - duration
  - user ID
  - environment
- `/api/health` reports:
  - DB connectivity
  - origin readiness
  - email readiness
  - uptime

Partially implemented:

- Error logs and startup logs go through `console.log`, `console.warn`, and `console.error`.
- Request logging is structured, but exception and startup logging are not consistently structured.

Missing:

- No metrics sink
- No tracing
- No log redaction framework
- No readiness/liveness split

## Runtime And Deployment Readiness

Implemented:

- Production env contract validation exists.
- CORS and HSTS behavior differ appropriately by environment.
- `start:prod` runs `env:check:prod` before `node app.js`.
- Upload serving behavior changes when object storage mode is enabled.

Partially implemented:

- Health depends on email readiness even though email is best-effort for many flows.
- `nodemon` is used for both `dev` and `start`, while `start:prod` correctly uses plain `node`.

Risky / needs hardening:

- There is no graceful shutdown path for the HTTP server or Knex pool.
- There is no queue worker, scheduler, or deployment manifest in repo scope.
- Development-only DB seeding in startup code increases the distance between dev and prod runtime behavior.

## Performance And Scalability Hotspots

Risky / needs hardening:

- In-memory rate limiting and lockout do not scale horizontally.
- OIDC exchange-code and lockout state are held in process memory only.
- Request logging writes synchronously through stdout for every request.
- Manual multipart parsing for drop hero uploads is more fragile than a hardened upload pipeline.
- Schema-introspection compatibility checks are useful during transition periods, but they add per-flow complexity and can mask incomplete migrations.
