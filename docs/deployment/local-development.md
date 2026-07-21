# Local development

## Startup

1. Install Node.js 24 and Docker Compose v2.
2. Copy `.env.example` to an uncommitted `.env`.
3. Run `npm install`.
4. Run `docker compose up -d postgres redis` and wait for healthy status.
5. Run `npm run db:generate`, `npm run db:migrate`, then `npm run db:seed`.
6. Run `npm run dev`.
7. Verify `/api/v1/health/live`, `/api/v1/health/ready`, `/api/docs`, the browser shell, and a test job.

The development override publishes infrastructure only on `127.0.0.1`. To approximate production network boundaries, use `docker compose -f docker-compose.yml up -d`, provide production-safe environment values, and access services through the deployment proxy.

## Shutdown

Stop watch processes with Ctrl+C so API, Redis clients, Prisma, and the worker close gracefully. Stop containers with `docker compose down`. Named volumes persist data; removing volumes is intentionally not part of the standard command because it is destructive.
