# ADR-003: PostgreSQL and Prisma

- Status: Accepted

## Context

Workspace membership, websites, audit records, and future content workflows need relational integrity, transactions, and well-understood operational tooling.

## Decision

Use PostgreSQL as the authoritative datastore and Prisma 7 with the PostgreSQL driver adapter, explicit generated-client output, committed migrations, and UUID identifiers.

## Alternatives considered

MongoDB would weaken the natural relational model. A handwritten SQL layer offers control but requires more Phase 0 mapping and typing work. Other TypeScript ORMs were viable but Prisma offers a concise schema and migration/client workflow.

## Consequences

The application gains typed queries and visible migrations. Prisma Client generation is a required build step, connection pools belong to the `pg` adapter, and advanced SQL must still be reviewed directly.
