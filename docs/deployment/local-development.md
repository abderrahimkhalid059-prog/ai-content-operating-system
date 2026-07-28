# Local development

## Startup

1. Install Node.js 24 and Docker Compose v2.
2. Copy `.env.example` to an uncommitted `.env`, set distinct access/refresh development secrets, and set a private `SEED_OWNER_PASSWORD` meeting the documented policy.
3. Run `npm install`.
4. Run `docker compose up -d postgres redis` and wait for healthy status.
5. Run `npm run db:generate`, `npm run db:migrate`, then `npm run db:seed`.
6. Run `npm run dev`.
7. Log in with `SEED_OWNER_EMAIL` and the locally supplied seed password. Verify `/api/v1/health/live`, `/api/v1/health/ready`, `/api/docs`, the authenticated browser shell, refresh rotation, and a test job.

The seed is disabled when `NODE_ENV=production`, fails when its password is missing, and may be run repeatedly. It creates the development Owner, workspace, Arabic sports placeholder site, and default Arabic editorial profile without printing the password.

The development override publishes infrastructure only on `127.0.0.1`. To approximate production network boundaries, use `docker compose -f docker-compose.yml up -d`, provide production-safe environment values, and access services through the deployment proxy.

## Shutdown

Stop watch processes with Ctrl+C so API, Redis clients, Prisma, and the worker close gracefully. Stop containers with `docker compose down`. Named volumes persist data; removing volumes is intentionally not part of the standard command because it is destructive.

Production must set `AUTH_COOKIE_SECURE=true`, use unrelated high-entropy access and refresh secrets from a secret manager, use HTTPS, and omit the development seed. Secret rotation and session revocation should be coordinated as described in the security baseline.

# Blogger Mock development

Set `BLOGGER_MODE=mock`. No Google credential or encryption key is required. Optionally set
`SEED_MOCK_BLOGGER_CONNECTION=true` before the explicit seed to attach the deterministic account
`mock-google-account-001` and blog `mock-blog-sports-001`; rerunning the seed creates no duplicate.
Leave public publish and delete false for normal development.

Live mode is a later manual validation path. Generate a local encryption key with the command in
ADR-012, keep it only in `.env`, set the Google client values and exact callback
`http://localhost:3000/api/v1/integrations/blogger/callback`, then follow
`docs/integrations/blogger-live-validation.md`.
