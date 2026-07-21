# ADR-004: Redis and BullMQ

- Status: Accepted

## Context

Future operations will need durable retries and background execution, while Phase 0 needs only to validate the asynchronous path.

## Decision

Use Redis for temporary processing state and BullMQ for queues. Establish a `system` queue, dotted job naming, correlation IDs, three attempts, exponential backoff, bounded result retention, and queue-event logging.

## Alternatives considered

Database polling was rejected because it duplicates mature queue behavior. RabbitMQ and managed cloud queues are strong options but add infrastructure and portability decisions not required yet. In-process jobs cannot survive API restarts.

## Consequences

API latency is decoupled from work and retries are standardized. Redis must be operated reliably, queue payloads must remain versionable, and PostgreSQL remains the source of truth for durable domain state.
