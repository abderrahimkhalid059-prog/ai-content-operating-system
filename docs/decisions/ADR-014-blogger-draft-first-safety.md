# ADR-014 — Blogger draft-first safety

## Status

Accepted for Phase 2.

## Decision

Manual integration testing may create drafts. Public publish and delete are disabled by default and
require all of: the global server flag, a connected Website, the fixed workspace permission, and an
explicit user request. Frontend controls reflect but cannot override the backend ceiling.

`BLOGGER_ALLOW_PUBLIC_PUBLISH=false` and `BLOGGER_ALLOW_DELETE=false` are the defaults in Mock and
Live mode. Phase 2 includes no automatic or scheduled publication.

## Consequences

Tests may enable both flags in isolated fixtures. Live validation begins read-only/draft-only and
requires separate authorization before any public write.
