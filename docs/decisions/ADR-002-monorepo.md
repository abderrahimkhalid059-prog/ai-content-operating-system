# ADR-002: npm-workspaces monorepo

- Status: Accepted

## Context

The API, web, worker, database client, and contracts evolve together and must share TypeScript quality policy.

## Decision

Use one npm 11 workspaces repository with root orchestration scripts and a single lockfile.

## Alternatives considered

Multiple repositories would create version drift and coordination overhead. pnpm is capable and efficient but adds an unnecessary package-manager requirement for this initial scale.

## Consequences

Atomic changes and uniform CI are straightforward. Root installs include all workspaces, and build ordering for generated/shared packages must remain explicit.
