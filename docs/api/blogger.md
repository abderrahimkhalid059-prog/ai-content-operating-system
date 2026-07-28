# Blogger integration API

All tenant routes use `/api/v1/workspaces/:workspaceId/websites/:websiteId`. They require bearer
authentication, active membership, the fixed permission named below, and a Website belonging to
the same workspace.

| Route                                               | Permission                                 | Purpose                                 |
| --------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| `GET /integrations`                                 | `integrations.read`                        | Safe connection summaries               |
| `GET /integrations/blogger`                         | `integrations.read`                        | Blogger status and safety ceiling       |
| `POST /integrations/blogger/connect`                | `integrations.connect`                     | Create one-time OAuth state             |
| `GET /api/v1/integrations/blogger/callback`         | secure state                               | Consume callback; no tenant query input |
| `GET /integrations/blogger/sites`                   | `integrations.read`                        | Paginated discovered blogs              |
| `POST /integrations/blogger/select-site`            | `integrations.update`                      | Provider-verified selection             |
| `POST /integrations/blogger/test`                   | `integrations.test`                        | Read-only connection test               |
| `POST /integrations/blogger/refresh`                | `integrations.update`                      | Refresh token lifecycle                 |
| `POST /integrations/blogger/sync`                   | `integrations.sync`                        | Enqueue BullMQ import                   |
| `GET /integrations/blogger/sync-runs`               | `integrations.read`                        | Safe run state/counters                 |
| `POST /integrations/blogger/disconnect`             | `integrations.disconnect`                  | Revoke locally and erase credentials    |
| `GET /external-posts`                               | `externalPosts.read`                       | Imported snapshots                      |
| `GET /external-labels`                              | `externalPosts.read`                       | Read-only aggregated labels             |
| `POST /integrations/blogger/test-posts`             | `providerPublishing.createDraft`           | Manual test draft                       |
| `PATCH /integrations/blogger/test-posts/:id`        | `providerPublishing.update`                | Update test post                        |
| `POST /integrations/blogger/test-posts/:id/publish` | `providerPublishing.publish` + server flag | Explicit publish                        |
| `DELETE /integrations/blogger/test-posts/:id`       | `providerPublishing.delete` + server flag  | Explicit delete                         |

The public `GET /api/v1/integrations/status` returns only active mode and safety flags. Swagger at
`/api/docs` documents the runtime routes. Responses never contain OAuth codes, tokens, credential
ciphertext, client secrets or stack traces.

Stable errors include `INTEGRATION_*` state/configuration errors and `BLOGGER_*` authorization,
permission, not-found, rate-limit, upstream, idempotency, HTML, sync and safety errors. Raw Google
responses are mapped to these safe codes.

## Fixed Phase 2 permissions

| Role        | Integration behavior                                                            |
| ----------- | ------------------------------------------------------------------------------- |
| OWNER       | Full integration and provider-publishing permissions                            |
| ADMIN       | Full integration and provider-publishing permissions; no workspace deactivation |
| EDITOR      | Read/test/sync/import and create/update draft                                   |
| REVIEWER    | Read safe integration, posts and labels                                         |
| SEO_MANAGER | Read safe integration, posts and labels                                         |
| WRITER      | Read safe integration/posts/labels and create draft                             |
| VIEWER      | Read safe integration/posts/labels only                                         |

Global publish/delete flags still override role permission.
