# ADR-008: Workspace tenant isolation

## Status

Accepted for Phase 1.

## Decision

Workspace IDs are explicit in every tenant-owned route. A global access-token guard establishes the user, a workspace guard loads an active membership and workspace, and a permission guard evaluates the current database role. Controllers receive a validated workspace context.

Website and content-profile services require `workspaceId` in every list, read, update, and deactivate predicate. Content profiles additionally require `websiteId`; a composite foreign key guarantees that profile and website workspace IDs agree. Inaccessible workspaces and cross-workspace raw IDs return a safe 404. Audit reads are workspace-scoped.

## Consequences

Frontend visibility is only a usability layer. Backend checks remain authoritative, and tests create two tenants to exercise list leakage and raw-object-ID attacks. Future tenant models must adopt the same route, guard, and query conventions.
