# Phase 1 API

The REST base is `/api/v1`; Swagger UI is `/api/docs` and OpenAPI JSON is `/api/docs-json`. Health and non-production infrastructure-job routes remain public. Every other route requires bearer authentication, except login and refresh.

Authentication routes cover login, refresh, logout, logout-all, current user, password change, session list, and session revocation. Refresh uses the HttpOnly cookie documented in ADR-006. User routes cover paginated administration, one-time temporary credentials, activation, reset, and session revocation.

Workspace routes expose list/create/read/update/deactivate and member list/add/role/remove. Website and content-profile routes are nested below `/workspaces/{workspaceId}`. The validated membership and permission context always precedes tenant-owned queries. Workspace audit reads return the most recent scoped events.

Errors use `ApiErrorResponse` with stable codes, French public messages, details, request ID, timestamp, and path. Swagger describes bearer/cookie authentication, DTO constraints, nested tenant routes, pagination, and operations; it never includes hashes, secrets, or raw tokens in example responses.
