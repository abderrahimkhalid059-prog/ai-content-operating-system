# AI Content Operating System

Production-oriented Phase 0 foundation for a future multi-workspace, multi-website content operations SaaS. This repository deliberately contains infrastructure and application foundations only; it does not contain content-generation or publishing business logic.

## Architecture

The project is a TypeScript npm-workspaces monorepo built as a modular monolith with three independently runnable processes:

- `apps/api`: NestJS REST API with URI versioning, Swagger, validated configuration, redacted JSON logging, health probes, and development queue validation routes.
- `apps/web`: French React/Vite administration shell using React Router and TanStack Query.
- `apps/worker`: BullMQ worker for the infrastructure-only `system.health-check` job.
- `packages/database`: Prisma 7 PostgreSQL client, schema, migration, seed, and lifecycle wrapper.
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

All server variables are validated at startup. Required settings are `NODE_ENV`, `API_PORT`, `WEB_PORT`, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `JWT_SECRET` (reserved only; no JWT implementation), `LOG_LEVEL`, `CORS_ORIGINS`, `APP_URL`, and `API_URL`. `REDIS_PASSWORD` is optional for local development. The browser receives only `VITE_API_URL`; never expose secrets with a `VITE_` prefix.

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

For an end-to-end container check, run `docker compose up -d --build --wait`, optionally load the development seed with `docker compose run --rm migrate npm run db:seed -w @ai-content-os/database`, then run `npm run validate:stack`. Compose applies committed migrations before starting the API and worker; the smoke test verifies the live stack, Swagger document, health probes, browser shell, and a BullMQ job processed by the real worker.

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

## Phase 0 scope

Implemented: monorepo foundations, strict TypeScript, API/web/worker shells, shared packages, PostgreSQL/Prisma schema, Redis/BullMQ test path, JSON logging, error handling, health probes, Swagger, Docker/Nginx, tests, CI, and documentation.

Not implemented: authentication business logic, billing, AI providers or content generation, research, article workflows, Blogger OAuth, WordPress publishing, SEO, affiliates, analytics, final UI design, or production deployment. Development seed records are placeholders and are not production credentials or content.
