import assert from 'node:assert/strict';

const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const webUrl = (process.env.APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const docsUrl = process.env.SWAGGER_JSON_URL ?? `${new URL(apiUrl).origin}/api/docs-json`;
const timeoutMs = Number(process.env.STACK_VALIDATION_TIMEOUT_MS ?? 30_000);

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

const webResponse = await fetch(webUrl);
const webBody = await webResponse.text();
assert.ok(webResponse.ok, `GET ${webUrl} returned ${webResponse.status}`);
assert.match(webBody, /<div id="root"><\/div>/);

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

console.log(
  'Full-stack validation passed: API, worker, PostgreSQL, Redis, BullMQ, health, Swagger, and web.',
);
