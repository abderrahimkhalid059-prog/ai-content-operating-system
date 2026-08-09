# Phase 3A progress checkpoint

## Completed work

- Audited the clean `phase/3a-content-domain-editor` branch at the validated Phase 2B tag.
- Added the provider-neutral content and immutable revision schema through one additive migration.
- Added workspace/site-scoped REST APIs, field-level RBAC, explicit editorial transitions, logical archive, safe HTML handling, metrics, slug/label normalization, assignment/profile validation, optimistic concurrency and sanitized audit events.
- Enforced writer ownership/assignment for transitions, made archived content read-only, and kept
  Unicode letters/numbers in slugs so Arabic titles remain usable.
- Added French content list, manual editor, status actions and immutable revision history.
- Added unit, API integration and React tests plus API/architecture/database/ADR documentation.

## Files created or modified

See `git status --short`. Principal additions are `apps/api/src/modules/contents`,
`apps/web/src/pages/contents`, migration `20260809120000_phase_3a_content_domain`, content tests,
`docs/api/contents.md` and ADR-015.

## Validation completed so far

- Prisma validate and generate: passed.
- Development migration: passed.
- Clean-database migration from Phase 0 through Phase 3A: passed.
- Clean-database schema diff: no difference.
- Seed with an ephemeral test password, executed twice: passed.
- Root typecheck: passed.
- API unit tests: 16/16 passed.
- Phase 3A API integration tests: 4/4 passed.
- Phase 3A React tests: 5/5 passed.
- Complete unit suite: 94/94 passed across 22 test files (the shared package has no tests and
  exits successfully with `--passWithNoTests`).
- Complete integration suite: 88/88 passed across 12 test files. API and Worker integration files
  run serially because they share Redis counters and queues.
- ESLint: passed.
- Modified-file Prettier check: passed.
- Production build: passed for all packages, API, Web and Worker.
- Docker build: API/migrate, Web and Worker images passed.
- Compose migration/startup/health: passed; PostgreSQL, Redis, API and Web healthy, Worker active.
- Swagger/health/Web smoke: HTTP 200; six content paths published; OpenAPI version 0.4.0.
- Full-stack validator: passed, including Phase 3A content/revisions/concurrency/workflow/archive
  and all preserved Phase 0–2 checks.
- Stack restored to the pre-validation Blogger `LIVE` mode with public publish and delete disabled.
- `git diff --check`: passed; `.env` and all Phase 0–2 migration files are unchanged.

## Current failures or blockers

- No Phase 3A functional or validation blocker.
- `npm audit` reports 27 transitive advisories (5 moderate, 22 high), and `npm audit --omit=dev`
  reports 11 (1 moderate, 10 high). npm reports no fix available. The chains are ESLint,
  Prisma/AJV, Nest Swagger/js-yaml and nanoid/postcss (also used by `sanitize-html`). No forced or
  breaking upgrade was applied.
- On this Windows checkout (`core.autocrlf=true`), repository-wide `npm run format:check` reports
  45 tracked Phase 0–2/tooling files because their working-tree endings are CRLF while Prettier
  expects LF. Every file modified for Phase 3A passes a targeted Prettier check, `git diff --check`
  passes, and unrelated historical files were not reformatted.
- A preliminary seed command without the mandatory `SEED_OWNER_PASSWORD` failed as designed; the
  two correctly configured seed runs passed.

## Unfinished work

- Phase 3A implementation and validation are complete. Windows line-ending policy and upstream
  dependency advisories remain maintenance work outside the Phase 3A feature scope.

## Exact next step

Review the working-tree diff, then commit through the project’s normal review process when
authorized. Do not begin Phase 3B from this checkpoint.

## Validation commands still required

```text
# No Phase 3A validation command remains required.
# Optional maintenance follow-up:
npm run format:check
npm audit
```
