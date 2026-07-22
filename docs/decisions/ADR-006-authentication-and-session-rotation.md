# ADR-006: Authentication and rotating server sessions

## Status

Accepted for Phase 1.

## Decision

Use Argon2id password hashes, 15-minute configurable JWT access tokens, rotating opaque refresh tokens, and PostgreSQL `Session` records. Access claims contain only the user ID, session ID, normalized email, and security version. A refresh token is `sessionId.randomSecret`; PostgreSQL stores only an HMAC-SHA-256 verifier using a refresh-only secret.

The browser receives access tokens and retains them in memory. Refresh tokens use an HttpOnly, SameSite=Lax cookie scoped to `/api/v1/auth`; production requires `Secure`. Each refresh replaces the verifier and cookie. Reuse of an old, revoked, expired, or invalid rotated token revokes its session family. Password resets increment the security version and revoke every session.

Login and refresh limits use Redis counters with a short configurable window. Invalid login responses are generic. There is no public registration, recovery email, social login, or MFA in Phase 1.

## Consequences

Role changes take effect from database authorization checks without waiting for token expiry. The API performs one indexed session lookup for authenticated requests. Refresh availability depends on PostgreSQL and Redis-backed abuse protection, both already required runtime dependencies.
