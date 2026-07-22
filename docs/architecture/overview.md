# Architecture overview

## Shape

AI Content OS is a modular monolith in one npm-workspaces repository. Modules share versioning and deployment governance while the API, browser application, and background worker run as separate processes. This preserves clear runtime boundaries without the operational cost or distributed consistency problems of microservices.

The NestJS API owns synchronous REST entry points and infrastructure orchestration. The React/Vite application is an API consumer and never connects directly to infrastructure. The worker owns asynchronous BullMQ execution and exposes no public network interface. Shared packages contain only framework-neutral contracts or infrastructure clients.

## State and processing

PostgreSQL is the source of truth for durable workspace, website, audit, setting, and job metadata. Redis is not authoritative; it provides BullMQ queue state and temporary processing coordination. Queue payloads carry correlation IDs so API requests, queue events, and worker logs can be traced together.

## Phase 1 identity and multi-workspace core

Users and workspaces have a many-to-many relationship through `WorkspaceMember`. Authentication combines memory-only access JWTs, rotating HttpOnly refresh cookies, and server-side sessions. Fixed roles resolve to a centralized permission map; membership and permissions are read from PostgreSQL instead of embedded in long-lived claims.

Each website belongs to exactly one workspace and can own configuration-only content profiles. Authentication, membership, and permission guards establish a trusted request context. Every tenant service predicate includes workspace ID, and composite database constraints prevent a content profile from referencing a website in another workspace. Ownership and default-profile changes use serializable transactions.

## Future provider abstractions

Publishing and AI integrations will be introduced behind application interfaces in later phases. No provider SDK, credential storage, executable prompt, or provider-specific domain behavior is present in Phase 1. Provider abstractions should remain inside the modular monolith until scale or isolation evidence justifies another architecture.
