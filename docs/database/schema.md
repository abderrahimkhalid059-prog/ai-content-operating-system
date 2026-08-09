# Phase 1 database schema

All identifiers are PostgreSQL UUIDs. Prisma uses TypeScript names while tables and columns map to `snake_case`. The additive `20260722120000_phase_1_identity_multisite` migration preserves Phase 0 history and maps legacy `MEMBER` memberships to `VIEWER`.

- `users`: normalized unique email, Argon2id hash, `ACTIVE`/`INACTIVE`, forced-change flag, security version, login and password timestamps. Hashes are backend-only.
- `sessions`: HMAC refresh verifier, family ID, expiry, use/revocation timestamps and bounded client metadata. Raw refresh tokens are never stored.
- `workspaces`: tenant boundary, unique slug and activation state.
- `workspace_members`: unique user/workspace membership and one of seven fixed roles.
- `websites`: workspace-owned generic site configuration, locale/timezone/description, workspace-scoped slug, status and soft-deactivation timestamp. It contains no provider credentials.
- `content_profiles`: website configuration with bounded JSON rules. A composite foreign key enforces website/workspace agreement; a partial unique index permits only one active default per website.
- `audit_logs`: actor, tenant/resource target, action, request/correlation ID, IP/user-agent context and redacted metadata.
- `system_settings` and `job_records`: preserved Phase 0 infrastructure foundations.

Session indexes cover `(user_id, revoked_at)`, expiry, and family. Tenant indexes cover membership, website status, content-profile status/default state, and audit chronology. Owner transitions, user deactivation/reset, workspace creation, and default-profile changes are transactional.

Pre-Phase-1 users receive a non-login sentinel hash and `must_change_password=true`; an explicit development seed or authorized administrative reset must establish an Argon2id credential.

# Phase 2 integration records

`WebsiteConnection` scopes a provider account/blog to both Workspace and Website. A partial unique
index permits one non-revoked Blogger connection per Website. `OAuthState` stores only a SHA-256
state hash with user/workspace/website binding, expiry and one-time consumption.

`ExternalPost` uniquely snapshots `(connection, provider, externalPostId)` and preserves hashes,
labels and external timestamps. Missing remote records are marked deleted. `ExternalTaxonomyTerm`
deduplicates normalized Blogger labels while retaining display names and usage counts.

`IntegrationSyncRun` tracks queue correlation, cursor, counters and safe failure state; a partial
index prevents two active runs per connection. `ProviderPublication` uniquely reserves idempotency
keys and request hashes before external mutations. All tenant records include Workspace and Website
foreign keys. Phase 2 migration `20260728110000_phase_2_blogger_integration` is additive.

# Phase 3A content records

Migration `20260809120000_phase_3a_content_domain` adds `content_items` and `content_revisions`
without changing prior migrations. A content item is unique by `(workspace_id, website_id, slug)`;
composite foreign keys prevent a profile or content from crossing its site boundary. Editorial and
publication statuses use separate PostgreSQL enums.

`content_revisions` stores immutable snapshots numbered from the content’s optimistic `version`.
Metrics have non-negative checks, revisions have a positive-number check, and indexes cover the
site/status chronology, publication state, assignee, creator, profile and revision history. Content
archival is logical and content deletion is not exposed by the Phase 3A API.
