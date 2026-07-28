# ADR-011 — Blogger Mock and Live modes

## Status

Accepted for Phase 2.

## Decision

`BLOGGER_MODE` is validated as `mock` or `live`. Development and test default to Mock; production
must explicitly select a mode and never silently falls back. Live mode fails startup without the
Google client ID, client secret and exact redirect URI.

Mock mode follows the same one-time OAuth-state lifecycle as Live mode and provides deterministic
account, blog, post, label, error and pagination fixtures. Simulation controls remain provider-test
inputs and are not production HTTP controls.

## Consequences

CI and local development require no Google account. Live code compiles and is contract-tested
against mocked HTTP, while real Google OAuth and Blogger validation remain a separate manual gate.
