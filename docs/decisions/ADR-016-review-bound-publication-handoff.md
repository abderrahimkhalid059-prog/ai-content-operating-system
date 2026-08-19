# ADR-016 — Revision-bound review and provider-neutral draft handoff

## Status

Accepted for Phase 3B.

## Context

Phase 3A already owns `ContentItem`, immutable revisions and editorial transitions. Phase 2 owns the
provider abstraction and `ProviderPublication` operation journal, but that journal describes calls,
not a durable content-to-provider identity. A review must never approve a newer version than the one
actually read, and repeated draft handoffs must not create multiple Blogger posts.

## Decision

Store comments and immutable review decisions as content-scoped tenant records. Each review points
to the exact revision ID and number. The existing content transition service changes `IN_REVIEW` to
`APPROVED` or `CHANGES_REQUESTED` and creates the review in one serializable transaction.

Add `ContentPublication` as the smallest provider-neutral stable binding. Its unique key is content
item + provider + external site. It stores the server-resolved external post ID, connection, binding
state and last synchronized revision/hash. `ProviderPublication` remains the operation journal and
references the binding for binding-scoped idempotency.

The API reserves the binding and operation before an external create. A current binding makes
repeated creates idempotent; changed content requires the explicit update action, which always uses
the stored external ID. Internal edits never trigger provider writes. Confirmed provider absence
sets `MISSING`; authorization or temporary failures set `ERROR` and may recover after reconnect.

## Consequences

- Review decisions cannot silently approve stale content.
- React state and browser-supplied external IDs are never authoritative.
- OAuth reconnection to the same site does not orphan the content binding.
- The internal and external revision positions are independently visible.
- Public publishing and external deletion remain outside Phase 3B even if Phase 2 test endpoints
  exist under separate permissions and server safety flags.
