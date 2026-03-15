# 03 Data Config And Integrations

## Data Layer

Implemented:

- Database access is through Knex with PostgreSQL.
- `src/core/db/migrations` contains the schema history for:
  - users and identity maps
  - artists and labels
  - products, variants, inventory SKU refactor
  - drops and drop products
  - orders, order events, payments, payment events, payment attempts
  - leads
  - artist access requests
  - media assets and entity media links
  - artist plan/subscription fields
  - refresh tokens
  - OIDC user fields
  - password reset fields
- Several services use schema introspection and cached table/column checks to stay compatible with partially migrated environments.

Partially implemented:

- Compatibility shims are widespread:
  - `hasTableCached`
  - `hasColumnCached`
  - `columnInfo()`
  - conditional column inserts/updates
- This makes the app more tolerant of rolling schema drift, but it also means some flows silently downgrade behavior when migrations are missing.

Risky / needs hardening:

- There are many migrations and several compatibility branches, but there is no internal schema/audit document in the repo explaining which migrations are now mandatory for production.
- The Knex connection is a singleton with no explicit shutdown handling in `app.js`.

## Schema Notes By Area

### Identity / Auth

- `users`
- `artist_user_map`
- `label_users_map`
- `auth_refresh_tokens`
- OIDC-related user columns
- password reset token/expiry columns

### Commerce

- `products`
- `product_variants`
- `inventory_skus`
- `orders`
- `order_items`
- `order_events`
- `payments`
- `payment_attempts`
- `payment_events`

### Campaign / Marketing

- `drops`
- `drop_products`
- `leads`
- `artist_access_requests`
- `media_assets`
- `entity_media_links`

## Environment And Config Contract

Implemented:

- `src/config/runtimeEnv.js` is the actual environment contract authority.
- Canonical runtime keys are now the documented contract: `FRONTEND_ORIGIN`, `BACKEND_BASE_URL`, `OIDC_APP_BASE_URL`, `OIDC_APP_CALLBACK_PATH`, `JWT_SECRET`, `JWT_REFRESH_SECRET`.
- `scripts/check_env_contract.js` validates the runtime contract before tests and startup lanes.
- `.env.example` now documents canonical keys only for:
  - frontend/public origin settings
  - backend base URL
  - OIDC
  - JWT access/refresh secrets
  - SendGrid
  - storage provider selection
  - upload scanning flags
- Production mode explicitly rejects localhost origins and backend URLs.

Partially implemented:

- `src/core/config/env.js` remains the dotenv/file loader and diagnostics entrypoint, while alias resolution stays isolated in `src/core/config/envAliases.js` and validation stays in `src/config/runtimeEnv.js`.
- Temporary alias compatibility is still accepted for a migration window, but only through the centralized alias resolver.
- `src/core/config/env.js` still exposes only:
  - `NODE_ENV`
  - `PORT`
  - `DATABASE_URL`
  - `JWT_SECRET`

Risky / needs hardening:

- New code can still accidentally read directly from `process.env` instead of the validated runtime contract, so future cleanup should continue collapsing remaining direct env reads behind `runtimeEnv` accessors.

## Integrations Audit

### Email

Implemented:

- SendGrid integration is lazy-loaded.
- Template rendering is centralized in `src/services/emailTemplates`.
- Email sending is best-effort for many domain flows and returns structured send results.

Partially implemented:

- Health/readiness treats email configuration as part of service readiness.
- Core business flows usually continue even when email delivery fails.

Risky / needs hardening:

- Email is operationally optional for many routes, but `/api/health` marks the service degraded when SendGrid config is missing. This is stricter than the application behavior and can block deployments or uptime checks unnecessarily.

### Payments

Implemented:

- Payment orchestration exists under `src/core/payments`.
- Mock provider flow is covered by tests and order lifecycle routes.

Missing:

- There is no real external payment provider implementation in the inspected codebase.

### Object Storage

Implemented:

- Storage provider selection supports `local` and `object`.
- Object-storage public URL generation is implemented.

Partially implemented:

- Object-storage provider validates required env and key normalization.

Missing:

- Actual object upload/delete operations are scaffold only and throw `object_storage_provider_not_implemented`.

### Upload Scanning

Implemented:

- Upload status metadata and gating exist.
- Scanner adapter abstraction exists.
- No-op scanner adapter exists.

Partially implemented:

- Scan enqueue happens only when uploads are marked pending.

Missing:

- No real scanner integration, queue, or asynchronous worker is present in the inspected repo.

## Backup And Restore

Implemented:

- `scripts/backup.js` shells out to `pg_dump` and writes SQL backups into `backups/`.

Missing:

- No restore script is present.
- No backup retention, encryption, verification, or offsite strategy is present in repo automation.
