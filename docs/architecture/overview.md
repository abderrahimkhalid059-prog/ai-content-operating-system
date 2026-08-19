# Architecture overview

## Shape

AI Content OS is a modular monolith in one npm-workspaces repository. Modules share versioning and deployment governance while the API, browser application, and background worker run as separate processes. This preserves clear runtime boundaries without the operational cost or distributed consistency problems of microservices.

The NestJS API owns synchronous REST entry points and infrastructure orchestration. The React/Vite application is an API consumer and never connects directly to infrastructure. The worker owns asynchronous BullMQ execution and exposes no public network interface. Shared packages contain only framework-neutral contracts or infrastructure clients.

## State and processing

PostgreSQL is the source of truth for durable workspace, website, audit, setting, and job metadata. Redis is not authoritative; it provides BullMQ queue state and temporary processing coordination. Queue payloads carry correlation IDs so API requests, queue events, and worker logs can be traced together.

## Phase 1 identity and multi-workspace core

Users and workspaces have a many-to-many relationship through `WorkspaceMember`. Authentication combines memory-only access JWTs, rotating HttpOnly refresh cookies, and server-side sessions. Fixed roles resolve to a centralized permission map; membership and permissions are read from PostgreSQL instead of embedded in long-lived claims.

Each website belongs to exactly one workspace and can own configuration-only content profiles. Authentication, membership, and permission guards establish a trusted request context. Every tenant service predicate includes workspace ID, and composite database constraints prevent a content profile from referencing a website in another workspace. Ownership and default-profile changes use serializable transactions.

## Phase 2 publishing-provider boundary

`packages/integrations` defines a framework-neutral publishing contract implemented by separate
Mock and Live Blogger adapters. NestJS services own workspace authorization, OAuth lifecycle,
connection history, publication idempotency and audit. The Worker owns paginated import and label
reconciliation through `blogger.sync-site`; PostgreSQL remains authoritative and Redis is only the
queue transport.

Mock and Live are selected centrally. Live credentials are AES-256-GCM envelopes decrypted only
inside backend provider composition. The React client sees only safe summaries and server safety
flags. Imported external posts are snapshots, not generated Articles.

## Phase 3A content domain

`ContentItem` is the provider-neutral editorial source of truth. It belongs to one workspace and
website, may reference a content profile and assignee, and carries separate editorial and external
publication states. The API applies field-level permissions, tenant predicates, HTML sanitization,
server-calculated metrics and optimistic concurrency.

Every accepted mutation creates an immutable `ContentRevision` in the same serializable
transaction. The browser provides French list, manual editor and revision-history views but does
not render stored HTML as executable markup. Phase 3A has no queue, AI generation or provider
publishing path.

## Phase 3B review and draft handoff

`ContentComment` stores bounded internal plain text and resolution history. `ContentReview` is an
immutable decision linked by a composite foreign key to the exact `ContentRevision` reviewed. The
existing editorial transition service performs the decision and status change in one serializable
transaction; a stale revision cannot be approved.

`ContentPublication` is the durable provider-neutral association between one content item and one
provider/site draft. `ProviderPublication` remains the append-only operation/idempotency journal and
optionally points to that association. The Content module resolves connection, external site and
external post identifiers server-side, then calls the existing `PublishingProvider` abstraction.
Internal edits only make the association out of sync; a separate human action updates the same
Blogger Draft. Confirmed missing drafts are never recreated automatically, authorization failures
never become deletion, and reconnecting the same site preserves the association.
