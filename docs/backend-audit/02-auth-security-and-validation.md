# 02 Auth Security And Validation

## Authentication Model

Implemented:

- Access tokens are JWT bearer tokens verified from the `Authorization` header.
- Refresh tokens are separate JWTs signed with `JWT_REFRESH_SECRET`.
- Refresh token rotation is backed by `auth_refresh_tokens` table records hashed with SHA-256.
- Login flows are split into:
  - generic login
  - `fan` portal login
  - `partner` portal login
- Google OIDC is implemented with signed state, portal validation, safe `returnTo` handling, and frontend-origin allowlisting.
- Password reset uses hashed reset tokens stored on `users` and revokes refresh sessions after reset.

Partially implemented:

- `resolveIncomingRefreshToken()` supports body, bearer header, and cookie lookup, but the app does not register cookie parsing middleware. In practice the refresh flow is body/header based.
- `attachAuthUser()` tolerates invalid bearer tokens and leaves rejection to `requireAuth`, which is acceptable but means malformed token telemetry is minimal.

Risky / needs hardening:

- Tokens are returned in JSON responses only; there is no cookie transport, secure cookie policy, or CSRF model because session state is not cookie-based.
- There is no issuer/audience verification layer around JWT payloads beyond the signing secret.
- Refresh-token rotation is sound for single-node operation, but overall auth state is still tied to process-local lockout/rate-limit memory for abuse controls.

## Authorization And RBAC

Implemented:

- RBAC policies exist in `src/core/rbac`.
- `requirePolicy()` attaches policy debugging headers on denial.
- Admin, artist, label, buyer, and drop-specific policy modules are present.
- Partner login does not authorize artist/label users by role alone; it also checks mapping tables:
  - `artist_user_map`
  - `label_users_map`

Partially implemented:

- Authorization is not fully centralized. Some routes use:
  - `requirePolicy()`
  - direct role guards
  - route-local helper checks
- The mixed style increases maintenance risk when introducing new endpoints.

## Abuse Controls

Implemented:

- Login rate limiting is applied on auth routes.
- In-memory account lockout exists after repeated failed password attempts.
- Order-creation spam guard exists.
- Generic in-memory rate limiting exists and records abuse flags.

Partially implemented:

- Rate limiting and account lockout are memory-backed `Map` instances only.
- Test/dev smoke bypasses exist via environment flags and `x-smoke-test` header.

Risky / needs hardening:

- Abuse protections do not survive process restarts and do not coordinate across multiple instances.
- `DISABLE_RATE_LIMIT` fully disables protection at process level.
- Debug logging can emit rate-limit hits and partner-login traces directly to stdout.

## Validation And Sanitization

Implemented:

- Zod is used in multiple request-validation paths, especially order creation.
- OIDC inputs are validated for portal, origin, callback path, and safe internal redirects.
- Password strength is enforced at registration and reset.
- Catalog mutation validation has dedicated validator files and regression tests.
- Multipart drop hero uploads validate:
  - content type
  - file size
  - allowed mime types

Partially implemented:

- Validation style is not uniform across the repo. Some endpoints use:
  - Zod schemas
  - route-local guards
  - service-level checks
  - manual `if` branches

Risky / needs hardening:

- The app uses manual multipart parsing for drop hero uploads instead of a hardened upload middleware. The parser enforces size and field extraction, but it increases maintenance and edge-case risk.

## Error Handling

Implemented:

- `fail()` produces a consistent JSON error envelope.
- The terminal error handler returns generic messages in production.
- Many domain paths map known failures to stable machine-readable error codes.

Partially implemented:

- Some routes/controllers return raw `{ error: "forbidden" }` style payloads directly instead of always using `fail()`.
- Console logging is the only error sink.

Risky / needs hardening:

- The global error handler logs `err.stack || err` to stderr but does not include request ID in the error log entry itself.
- There is no structured exception classification or alerting path.

## Security Posture Summary

Implemented:

- `helmet` is enabled.
- CORS is constrained to the resolved frontend origin.
- JWT access/refresh secrets are required outside test mode.
- Production runtime env rejects localhost origins and backend URLs.
- OIDC callback and frontend public-origin rules are explicitly enforced.

Missing:

- No CSRF protection because the app is not using cookies for auth.
- No secure session cookie strategy.
- No audit trail persistence for authentication events.
- No persistent distributed rate limiting or lockout storage.
- No secret rotation mechanism beyond environment changes and restart.
