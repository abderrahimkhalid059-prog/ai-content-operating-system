# ADR-001: Modular monolith

- Status: Accepted

## Context

The platform will span several domains, but Phase 0 has one team, no demonstrated independent scaling boundaries, and strong consistency needs around tenants and websites.

## Decision

Use a modular monolith with explicit NestJS/application module boundaries and one repository. API and worker are separate processes of the same system, not separate services.

## Alternatives considered

Microservices were rejected because deployment, networking, observability, contracts, and distributed transactions would add cost before there is evidence of benefit. An unstructured monolith was rejected because it makes future domain ownership unsafe.

## Consequences

Cross-module changes are simple and transactional consistency is available. Boundaries require code-review discipline; a future extraction remains possible when operational evidence justifies it.
