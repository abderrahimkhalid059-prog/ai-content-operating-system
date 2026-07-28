# AI Content Operating System

Production-oriented Phase 2 Blogger-integration foundation for a content operations SaaS. It
preserves the Phase 0/1 identity and multi-website core and adds a secure, workspace-scoped,
draft-first Blogger transport that is fully usable in deterministic Mock mode.

## Architecture

The project is a TypeScript npm-workspaces monorepo built as a modular monolith with three independently runnable processes:

- `apps/api`: NestJS REST API with rotating sessions, workspace authorization, tenant CRUD, Swagger, validated configuration, redacted JSON logging, health probes, and queue validation routes.
- `apps/web`: French React/Vite administration application with memory-only access tokens, silent refresh, protected routes, workspace selection, and permission-aware management screens.
- `apps/worker`: BullMQ worker for health validation and paginated Blogger synchronization.
- `packages/database`: Prisma 7 PostgreSQL client, schema, migration, seed, and lifecycle wrapper.
- `packages/integrations`: framework-independent Mock/Live Blogger provider adapters and credential encryption.
- `packages/config`, `shared`, `contracts`, and `testing`: framework-neutral shared foundations.

PostgreSQL is the source of truth. Redis provides queue and temporary processing state. See [architecture overview](docs/architecture/overview.md) and the ADRs in `docs/decisions`.

## Prerequisites

- Node.js 24 LTS and npm 11+
- Docker with Compose v2 for local PostgreSQL/Redis and container validation
- Git

On Windows systems that block PowerShell script shims, use `npm.cmd` in place of `npm`; no execution-policy change is required.

## Local setup

1. Copy `.env.example` to `.env` locally and replace development placeholders where appropriate. Never commit `.env`.
2. Install dependencies: `npm install`.
3. Start dependencies: `docker compose up -d postgres redis`.
4. Generate Prisma Client: `npm run db:generate`.
5. Apply the migration: `npm run db:migrate`.
6. Load the documented development seed: `npm run db:seed`.
7. Start all processes: `npm run dev`.

The UI is available at `http://localhost:5173`, API health at `http://localhost:3000/api/v1/health`, and Swagger at `http://localhost:3000/api/docs`.

## Environment variables

All server variables are validated at startup. Authentication requires distinct `JWT_ACCESS_SECRET` and `REFRESH_TOKEN_SECRET`, configurable access/refresh TTLs, cookie name/secure policy, password minimum, and login-rate window/max. Production requires secure cookies. `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` are used only by the explicit development seed; the password is mandatory, never logged, and should remain in an ignored local environment file. The browser receives only `VITE_API_URL`; never expose secrets with a `VITE_` prefix.

`BLOGGER_MODE=mock` needs no Google credentials. Production requires an explicit mode; Live mode
requires Google OAuth values and an AES-256-GCM key. Public publish and delete default to false.
See [Blogger API](docs/api/blogger.md) and the
[future Live checklist](docs/integrations/blogger-live-validation.md).

## Commands

| Command                                           | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| `npm run dev`                                     | Run API, web, and worker in watch mode             |
| `npm run dev:api`, `dev:web`, `dev:worker`        | Run one application                                |
| `npm run build`                                   | Generate Prisma client and build all packages/apps |
| `npm run lint` / `typecheck`                      | Static quality gates                               |
| `npm run format` / `format:check`                 | Apply/check Prettier                               |
| `npm run test`, `test:unit`, `test:integration`   | Test suites; integration requires services         |
| `npm run db:generate`, `db:migrate`, `db:seed`    | Prisma lifecycle                                   |
| `npm run validate:stack`                          | Smoke-test a running Compose stack                 |
| `npm run docker:up`, `docker:down`, `docker:logs` | Compose lifecycle                                  |

The committed Compose base does not publish PostgreSQL or Redis. `docker-compose.override.yml`, loaded automatically for development, binds them to localhost only. Production deployments should omit the override and provide secrets via the deployment environment.

For an end-to-end container check, export a local `SEED_OWNER_PASSWORD`, run `docker compose up -d --build --wait`, load the development seed with `docker compose run --rm migrate npm run db:seed -w @ai-content-os/database`, then run `npm run validate:stack`. Compose applies committed migrations before starting the API and worker. The validator checks the Phase 0 health/Swagger/web/BullMQ path plus login, refresh rotation, authenticated workspace access, Website CRUD, content profiles, and cross-tenant rejection.

## Infrastructure validation job

Outside production, `POST /api/v1/system/test-job` adds `system.health-check`; `GET /api/v1/system/test-job/:jobId` returns its BullMQ state and result. The job carries a correlation ID, uses three attempts with exponential backoff, and has bounded retention. These routes return `403` in production.

## Testing

Unit tests do not need external services. Database and BullMQ integration tests run when `TEST_DATABASE_URL` and `TEST_REDIS_URL` are present. The CI integration job supplies both, applies the migration, and runs the relationship and queue-processing suites.

## Troubleshooting

- **Environment validation failure:** compare the error’s variable names with `.env.example`.
- **Readiness is 503:** confirm both containers are healthy with `docker compose ps` and check `DATABASE_URL`/Redis host settings.
- **PowerShell rejects npm.ps1:** use `npm.cmd`; do not weaken machine execution policy.
- **Prisma cannot connect:** local host commands use `localhost:5432`; containers use the Compose host `postgres:5432`.
- **Queue remains waiting:** ensure `apps/worker` is running and points to the same Redis instance as the API.

## Phase 2 scope

Implemented: all validated Phase 0/1 behavior plus provider abstraction, deterministic Mock OAuth
and Blogger fixtures, Live HTTP adapter contract, encrypted live credentials, secure one-time OAuth
state, blog discovery/selection, BullMQ imports, labels, manual draft CRUD, safety ceilings,
idempotency, audit and French administration.

Not implemented: real Google/Blogger validation, automatic or scheduled publishing, WordPress,
AI/content generation, research, fact verification, SEO engines, images, affiliates, analytics,
billing or any Phase 3 feature. Development fixtures are not production credentials or content.
