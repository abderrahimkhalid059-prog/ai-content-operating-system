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
