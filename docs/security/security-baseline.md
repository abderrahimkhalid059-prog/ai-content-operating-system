# Phase 1 security baseline

## Identity and passwords

Passwords use Argon2id with 64 MiB memory, three iterations, and a configurable minimum of at least 12 characters including a letter and number. Plaintext, hashes, temporary passwords, Authorization headers, cookies, and authentication secrets are excluded from logs and audit metadata. Temporary passwords are generated randomly, returned only in the create/reset response, and require immediate change. Reset, deactivation, logout-all, and explicit revocation invalidate sessions.

## Tokens and cookies

JWT access tokens default to 15 minutes and contain only `sub`, session ID, normalized email, and security version. The web client retains them only in memory. Opaque refresh tokens default to seven days, rotate on every use, and are represented in PostgreSQL only by a refresh-secret HMAC verifier. Reuse revokes the session family.

The refresh cookie is HttpOnly, SameSite=Lax, scoped to `/api/v1/auth`, and mandatory-Secure in production. CORS is an explicit credentials-enabled allowlist. Access and refresh secrets must differ and must be rotated through the deployment secret store; rotating the access secret invalidates access JWTs, while rotating the refresh secret requires revoking active sessions.

## Authorization and tenant isolation

Every protected request validates the access token, live server session, user status, and security version. Workspace routes then validate active membership and current database role. All tenant-owned queries include workspace ID, and nested content profiles include both workspace and website IDs. Inaccessible workspace/resource IDs return safe 404 responses. Serializable ownership transactions prevent removing or demoting the last active Owner.

## Abuse, audit, and errors

Redis applies short-window login and refresh limits. Login failure is generic and uses an email fingerprint in audit metadata. Sensitive operations are audited with safe request context. Global errors preserve stable codes without production stack traces. Helmet, input whitelisting, unknown-field rejection, request IDs, structured redaction, loopback-only development infrastructure, and private Compose backend networking remain enabled.

MFA, recovery email, social login, custom roles, external provider credentials, and every Phase 2 integration remain deliberately deferred.
