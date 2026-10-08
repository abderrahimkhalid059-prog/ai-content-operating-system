# ADR-018 — Controlled AI draft preview and apply

## Status

Accepted for Phase 4B.

## Context

The Phase 4A runtime can execute provider-neutral prompts safely, but writing model output directly
into an article would collapse generation and editorial authorization, weaken optimistic
concurrency, and make retries capable of creating revisions.

## Decision

Article generation uses versioned prompt `article.draft@1` and creates a durable,
workspace-scoped `AiGenerationCandidate`. Provider output must match a strict JSON allowlist and
pass HTML and size controls. Generation returns a preview and does not mutate `ContentItem` or
`ContentRevision`.

Applying is a separate human action and permission. It checks the saved base revision, claims the
candidate in a serializable transaction and creates exactly one normal revision with the AI run,
candidate and base version as provenance. Replays return the same result; stale candidates are not
consumed. Discard is explicit and leaves content unchanged.

## Consequences

- Refresh and retry do not lose the provider result or create duplicate revisions.
- Existing revision, tenant, RBAC, audit and publication controls remain authoritative.
- Generated output remains untrusted even after persistence and is revalidated at apply time.
- Phase 4B adds no research, approval, external publication, Blogger mutation or paid-provider
  requirement.
