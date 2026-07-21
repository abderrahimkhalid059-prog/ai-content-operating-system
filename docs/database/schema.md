# Phase 0 database schema

All identifiers are PostgreSQL UUIDs. Prisma model names use TypeScript conventions while tables and columns map consistently to `snake_case`.

- `users`: identity placeholder with unique email and optional display name; no password or authentication behavior.
- `workspaces`: tenant boundary with a unique slug.
- `workspace_members`: unique user/workspace membership with a minimal role enum.
- `websites`: belongs to one workspace; contains name, workspace-scoped slug, platform, language, IANA timezone, and lifecycle status.
- `system_settings`: JSON settings optionally scoped to a workspace. Secrets must not be stored as plain JSON values.
- `audit_logs`: immutable-style event foundation with optional user, workspace, and website references.
- `job_records`: durable reference foundation for external queue jobs; BullMQ/Redis remains the live queue-state store.

Relationships:

```text
User 1 ── * WorkspaceMember * ── 1 Workspace 1 ── * Website
                                      ├── * SystemSetting
                                      ├── * AuditLog
                                      └── * JobRecord
```

`WebsitePlatform` supports `BLOGGER`, `WORDPRESS`, and `OTHER`; this is classification only, not an integration. `WebsiteStatus` supports `ACTIVE`, `INACTIVE`, and `DRAFT`. Indexes cover workspace membership, website status, audit timelines, correlations, and job status. Test databases must be isolated and disposable; set `TEST_DATABASE_URL` and never point cleanup utilities at shared or production data.
