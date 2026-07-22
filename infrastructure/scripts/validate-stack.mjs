import assert from 'node:assert/strict';

const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const webUrl = (process.env.APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const docsUrl = process.env.SWAGGER_JSON_URL ?? `${new URL(apiUrl).origin}/api/docs-json`;
const timeoutMs = Number(process.env.STACK_VALIDATION_TIMEOUT_MS ?? 30_000);
const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'developer@example.invalid';
const ownerPassword = process.env.SEED_OWNER_PASSWORD;
assert.ok(ownerPassword, 'SEED_OWNER_PASSWORD is required for authenticated stack validation.');

async function responseBody(response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(url, init) {
  const response = await fetch(url, init);
  const body = await responseBody(response);
  assert.ok(
    response.ok,
    `${init?.method ?? 'GET'} ${url} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  return body;
}

async function requestWithResponse(url, init) {
  const response = await fetch(url, init);
  const body = await responseBody(response);
  assert.ok(
    response.ok,
    `${init?.method ?? 'GET'} ${url} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  return { response, body };
}

async function poll(check, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not complete within ${timeoutMs}ms`, { cause: lastError });
}

const live = await request(`${apiUrl}/health/live`);
assert.equal(live.status, 'ok');

const ready = await request(`${apiUrl}/health/ready`);
assert.deepEqual(ready.services, {
  database: { status: 'up' },
  redis: { status: 'up' },
});

const summary = await request(`${apiUrl}/health`);
assert.equal(summary.status, 'ok');

const swagger = await request(docsUrl);
assert.match(swagger.openapi, /^3\./);
assert.ok(Object.keys(swagger.paths).some((path) => path.endsWith('/health/ready')));
assert.ok(Object.keys(swagger.paths).some((path) => path.endsWith('/auth/login')));
assert.ok(
  Object.keys(swagger.paths).some((path) => path.includes('/workspaces/{workspaceId}/websites')),
);

const webResponse = await fetch(webUrl);
const webBody = await webResponse.text();
assert.ok(webResponse.ok, `GET ${webUrl} returned ${webResponse.status}`);
assert.match(webBody, /<div id="root"><\/div>/);

const login = await requestWithResponse(`${apiUrl}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
});
assert.ok(login.body.accessToken);
assert.equal(login.body.user.email, ownerEmail.toLowerCase());
const firstCookie = login.response.headers.get('set-cookie');
assert.match(firstCookie ?? '', /HttpOnly/i);
assert.match(firstCookie ?? '', /SameSite=Lax/i);
assert.match(firstCookie ?? '', /Path=\/api\/v1\/auth/i);

const refreshed = await requestWithResponse(`${apiUrl}/auth/refresh`, {
  method: 'POST',
  headers: { cookie: firstCookie },
});
const rotatedCookie = refreshed.response.headers.get('set-cookie');
assert.ok(rotatedCookie);
assert.notEqual(rotatedCookie?.split(';')[0], firstCookie?.split(';')[0]);
const authorization = { authorization: `Bearer ${refreshed.body.accessToken}` };

const workspaces = await request(`${apiUrl}/workspaces`, { headers: authorization });
assert.ok(Array.isArray(workspaces) && workspaces.length > 0);
const primaryWorkspace = workspaces[0];
assert.ok(primaryWorkspace.permissions.includes('websites.create'));

const validationSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isolationWorkspace = await request(`${apiUrl}/workspaces`, {
  method: 'POST',
  headers: { ...authorization, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Validation isolation', slug: `validation-${validationSuffix}` }),
});

const website = await request(`${apiUrl}/workspaces/${primaryWorkspace.id}/websites`, {
  method: 'POST',
  headers: { ...authorization, 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'Validation multi-site',
    slug: `validation-${validationSuffix}`,
    platform: 'OTHER',
    language: 'fr',
    locale: 'fr-MA',
    timezone: 'Africa/Casablanca',
    status: 'DRAFT',
  }),
});
const updatedWebsite = await request(
  `${apiUrl}/workspaces/${primaryWorkspace.id}/websites/${website.id}`,
  {
    method: 'PATCH',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'ACTIVE' }),
  },
);
assert.equal(updatedWebsite.status, 'ACTIVE');

const profile = await request(
  `${apiUrl}/workspaces/${primaryWorkspace.id}/websites/${website.id}/content-profiles`,
  {
    method: 'POST',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Profil de validation',
      language: 'fr',
      tone: 'Professionnel',
      editorialRules: { attributionRequired: true },
      isDefault: true,
    }),
  },
);
assert.equal(profile.isDefault, true);

const isolated = await fetch(
  `${apiUrl}/workspaces/${isolationWorkspace.id}/websites/${website.id}`,
  { headers: authorization },
);
assert.equal(isolated.status, 404, 'A raw Website ID crossed a workspace boundary.');

await request(`${apiUrl}/workspaces/${primaryWorkspace.id}/websites/${website.id}`, {
  method: 'DELETE',
  headers: authorization,
});
await request(`${apiUrl}/workspaces/${isolationWorkspace.id}/deactivate`, {
  method: 'POST',
  headers: authorization,
});

const queued = await request(`${apiUrl}/system/test-job`, { method: 'POST' });
assert.equal(queued.name, 'system.health-check');
assert.ok(queued.id);
assert.ok(queued.correlationId);

const completed = await poll(async () => {
  const status = await request(`${apiUrl}/system/test-job/${encodeURIComponent(queued.id)}`);
  if (status.state === 'failed') throw new Error(`BullMQ job failed: ${status.failedReason}`);
  return status.state === 'completed' && status.result?.healthy === true ? status : undefined;
}, 'BullMQ health-check job');

assert.equal(completed.correlationId, queued.correlationId);
assert.deepEqual(completed.result.healthy, true);
assert.equal(completed.result.correlationId, queued.correlationId);

await request(`${apiUrl}/auth/logout`, {
  method: 'POST',
  headers: { ...authorization, cookie: rotatedCookie },
});

console.log(
  'Full-stack validation passed: API, worker, PostgreSQL, Redis, BullMQ, health, Swagger, web, auth rotation, workspace access, Website CRUD, content profiles, and tenant isolation.',
);
