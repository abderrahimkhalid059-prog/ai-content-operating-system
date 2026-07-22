# ADR-009: Browser access-token memory storage

## Status

Accepted for Phase 1.

## Decision

The React application stores access tokens only in module memory. It performs an HttpOnly-cookie refresh during initial boot, enables credentials on API requests, and coordinates one shared refresh promise to prevent parallel refresh storms. A failed refresh clears memory and sends the user to login; 403 remains distinct from 401.

Only the selected workspace ID may be persisted in localStorage. Access tokens, refresh tokens, passwords, and permissions are never persisted there. The refresh token is unavailable to JavaScript.

## Consequences

A page reload requires one refresh request, while token theft through persistent browser storage is avoided. CSRF exposure is constrained because the cookie path covers only authentication endpoints, SameSite is Lax, and application mutations require bearer access tokens.
