# ADR-013 — Provider publication idempotency

## Status

Accepted for Phase 2.

## Decision

Each provider mutation reserves a `ProviderPublication` identified by
`(connectionId, provider, idempotencyKey)` before calling the provider. A SHA-256 request hash binds
the key to one operation and payload. A completed identical retry returns the stored external post;
a changed request or concurrent pending mutation returns a conflict.

## Consequences

Timeout retries do not create duplicate Blogger posts. The database unique constraint remains the
last concurrency barrier and external post IDs are persisted with completed operations.
