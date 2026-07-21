# ADR-005: API, web, and worker process separation

- Status: Accepted

## Context

HTTP serving, static browser delivery, and background job execution have different lifecycle, scaling, and failure characteristics.

## Decision

Keep three deployable applications within the modular monolith: NestJS API, React/Vite web, and a private TypeScript worker.

## Alternatives considered

Running jobs inside the API risks shutdown and scaling contention. Server-side rendering is unnecessary for the internal administration shell. Separate service repositories would undermine the modular-monolith decision.

## Consequences

Each process can restart and scale independently, and the worker has no public surface. Shared packages and queue contracts require coordinated builds, and deployments must start at least one worker for asynchronous processing.
