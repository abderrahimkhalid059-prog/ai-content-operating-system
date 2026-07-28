# ADR-010 — Publishing provider abstraction

## Status

Accepted for Phase 2.

## Decision

Publishing transports implement the framework-independent `PublishingProvider` contract in
`packages/integrations`. Controllers call application services, never a Blogger HTTP endpoint.
A single factory selects Mock or Live mode at the composition boundary. Provider contracts expose
safe values only and never Prisma records.

`MockBloggerProvider` and `LiveBloggerProvider` implement the same OAuth, discovery, taxonomy,
pagination, read, draft, update, publish and delete operations. A later WordPress implementation
may implement this contract, but WordPress itself is outside Phase 2.

## Consequences

Business orchestration, tenant checks, idempotency and audit remain provider-independent. Provider
errors are stable, sanitized and classified as retryable or permanent.
