# Architecture overview

## Shape

AI Content OS is a modular monolith in one npm-workspaces repository. Modules share versioning and deployment governance while the API, browser application, and background worker run as separate processes. This preserves clear runtime boundaries without the operational cost or distributed consistency problems of microservices.

The NestJS API owns synchronous REST entry points and infrastructure orchestration. The React/Vite application is an API consumer and never connects directly to infrastructure. The worker owns asynchronous BullMQ execution and exposes no public network interface. Shared packages contain only framework-neutral contracts or infrastructure clients.

## State and processing

PostgreSQL is the source of truth for durable workspace, website, audit, setting, and job metadata. Redis is not authoritative; it provides BullMQ queue state and temporary processing coordination. Queue payloads carry correlation IDs so API requests, queue events, and worker logs can be traced together.

## Multi-workspace direction

Users and workspaces have a many-to-many relationship through `WorkspaceMember`. Each website belongs to exactly one workspace, and a workspace can contain multiple websites. Future Phase 1 authorization must enforce workspace scope at every API boundary before any tenant-owned query is executed.

## Future provider abstractions

Publishing and AI integrations will be introduced behind application interfaces in later phases. No provider SDK, credential storage, or provider-specific domain behavior is present in Phase 0. Provider abstractions should remain inside the modular monolith until scale or isolation evidence justifies another architecture.
