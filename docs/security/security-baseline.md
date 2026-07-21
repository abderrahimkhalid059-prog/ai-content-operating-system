# Security baseline

## Secrets and configuration

Server configuration is validated before startup. Real `.env` files are ignored, examples contain development-only placeholders, and the browser environment is limited to the non-secret `VITE_API_URL`. Production secrets must come from the deployment platform. The reserved JWT secret does not imply authentication exists.

## Logging

Pino emits structured JSON with service and environment context. Authorization, cookies, password/token/secret/API-key fields, database URLs, and JWT secrets are redacted. Production errors use a generic message and never expose a stack trace through HTTP responses. Correlation fields are supported without logging request bodies by default.

## HTTP and networks

Helmet establishes API security headers, CORS is an explicit allowlist, validation rejects unknown DTO properties, and Nginx supplies proxy and baseline browser headers. The base Compose network keeps PostgreSQL and Redis internal; development exposes them on loopback only. TLS is a deployment concern and no fake certificate is shipped.

## Dependencies and environments

The lockfile is validated with `npm ci` in CI. Dependency updates require normal review and automated quality gates. Development data and secrets are never suitable for production. Production should use separate databases, Redis instances, credentials, origins, and least-privilege network policies.

## Future authentication

Phase 1 must define identity verification, session/token lifecycle, workspace authorization, rate limiting, audit coverage, secret encryption/rotation, and recovery processes before tenant features are exposed. Authentication and authorization are intentionally absent in Phase 0.
