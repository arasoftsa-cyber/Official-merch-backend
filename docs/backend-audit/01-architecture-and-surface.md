# 01 Architecture And Surface

## Application Bootstrap

Implemented:

- `app.js` is the single runtime bootstrap and exported Express app.
- Runtime startup validates environment through `src/config/runtimeEnv.js` before listening.
- Core middleware order is:
  - `cors`
  - `helmet`
  - JSON/urlencoded parsers
  - JSON charset normalization wrapper
  - optional `/uploads` static mount
  - `attachAuthUser`
  - request ID
  - request logging
  - `/api/health`
  - `/api` route tree
  - terminal error handler
- Health routing is mounted separately from feature routing.

Partially implemented:

- Process-level `unhandledRejection` and `uncaughtException` handlers log but do not trigger graceful shutdown.
- Development startup mutates the database by normalizing seeded user roles and seeding artist access requests.

Risky / needs hardening:

- `ensureSeededUserRoles()` calls `db.destroy()` during startup, then later code relies on lazy reconnection through `getDb()`. This works because the Knex singleton is recreated on demand, but it is unusual startup behavior and increases operational ambiguity.

## Module Map

### Core

- `src/core/config`
  - legacy dotenv loader and path/upload helpers
- `src/config`
  - runtime env normalization and origin/public URL contract
- `src/core/db`
  - Knex connection, migration history, schema cache
- `src/core/http`
  - auth attach/require, RBAC policy middleware, request ID, logging, rate limiting, lockout, spam guard, error response
- `src/core/payments`
  - payment orchestration with a mock provider
- `src/core/rbac`
  - role and drop policy checks

### Feature Services / Controllers

- `src/controllers`
  - auth, artist, onboarding, homepage, leads, catalog
- `src/services`
  - auth refresh lifecycle
  - OIDC
  - password reset
  - users
  - catalog
  - dashboard/label dashboard
  - artist access requests
  - email + email templates
  - media assets
  - leads
- `src/storage`
  - provider selection
  - local storage implementation
  - object-storage scaffold
  - upload metadata
  - upload scan/status pipeline

### Routes

- `src/routes/index.js` is the main route aggregator.
- Feature routes are split into top-level routers and sub-routers for:
  - auth
  - onboarding / admin provisioning
  - artists
  - catalog / admin catalog
  - labels / label dashboard
  - drops
  - orders
  - payments
  - leads
  - artist access requests
  - homepage
  - admin
  - product variants

## Route Surface

Implemented route groups:

- `/api/auth/*`
  - password login
  - portal-specific login
  - register
  - password forgot/reset
  - Google OIDC start/callback/exchange
  - refresh
  - logout
  - whoami/probe
- `/api/products*`, `/api/artist/products*`, `/api/admin/products*`
  - public product reads
  - artist onboarding request submission
  - admin onboarding review
  - product creation/update/photo update
- `/api/orders/*`
  - buyer-style listing/read
  - order creation
  - cancel
  - pay
  - payment-confirmation handoff
- `/api/payments/*`
  - payment confirmation flow
- `/api/drops/*`, `/api/admin/drops/*`, `/api/artist/drops/*`
  - public drop listing/detail/products
  - artist/admin drop CRUD and lifecycle
  - hero upload handling
- `/api/admin/*`
  - dashboard summary/metrics
  - admin orders
  - admin payments
  - admin artist linking and subscription flows
  - optional test seed routes
- `/api/artist-access-requests/*`
  - public submission
  - admin review
- `/api/leads/*`
  - lead submission and admin listing
- `/api/homepage/*`, `/api/admin/homepage/*`
  - homepage data and admin homepage management
- `/api/health`
  - readiness endpoint

Partially implemented:

- Some routers preserve compatibility aliases, for example label dashboard aliases and multiple drops mount points.
- `scripts/audit_routes.js` still assumes an older repo shape (`../frontend`, `routes/` at repo root), so it is not a reliable source of truth for the current backend tree.

## Public / Protected Boundary

Implemented:

- Public reads exist for catalog, homepage, drops, auth entrypoints, and artist access request submission.
- Protected mutation/read paths consistently call `requireAuth` and, where present, `requirePolicy`.
- Admin routes additionally enforce role checks through `ensureAdmin`.

Partially implemented:

- Some routes rely on direct role guards (`requireAdmin`, `rejectLabelMutations`, `allowAdminOrArtist`) instead of policy middleware.
- Route protection is coherent, but authorization style is mixed between route-local role checks and centralized RBAC.
