import { randomUUID } from 'node:crypto';
import { validateEnvironment } from '@ai-content-os/config';
import type { BloggerSyncJobData } from '@ai-content-os/contracts';
import {
  DatabaseService,
  IntegrationMode,
  PublishingProviderType,
  WebsiteConnectionStatus,
  WebsitePlatform,
  WebsiteStatus,
  WorkspaceRole,
} from '@ai-content-os/database';
import { JOB_NAMES, QUEUE_NAMES } from '@ai-content-os/shared';
import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BloggerSyncProcessor } from '../src/blogger-sync';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required for Blogger sync tests.');
}
const redisConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const database = new DatabaseService(databaseUrl);
const queue = new Queue<BloggerSyncJobData>(QUEUE_NAMES.integrations, {
  connection: redisConnection,
});
const events = new QueueEvents(QUEUE_NAMES.integrations, {
  connection: redisConnection.duplicate(),
});
const config = validateEnvironment({
  NODE_ENV: 'test',
  API_PORT: '3001',
  WEB_PORT: '5174',
  DATABASE_URL: databaseUrl,
  REDIS_HOST: new URL(redisUrl).hostname,
  REDIS_PORT: new URL(redisUrl).port || '6379',
  JWT_ACCESS_SECRET: 'worker-test-access-secret-with-more-than-32-characters',
  JWT_ACCESS_TTL: '15m',
  REFRESH_TOKEN_SECRET: 'worker-test-refresh-secret-different-and-long-enough',
  REFRESH_TOKEN_TTL: '7d',
  AUTH_COOKIE_NAME: 'worker_test_refresh',
  AUTH_COOKIE_SECURE: 'false',
  PASSWORD_MIN_LENGTH: '12',
  LOGIN_RATE_LIMIT_WINDOW: '60s',
  LOGIN_RATE_LIMIT_MAX: '10',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'http://localhost:5174',
  APP_URL: 'http://localhost:5174',
  API_URL: 'http://localhost:3001/api/v1',
  BLOGGER_MODE: 'mock',
  BLOGGER_SYNC_PAGE_SIZE: '2',
});
const processor = new BloggerSyncProcessor(database, config);
const worker = new Worker<BloggerSyncJobData>(
  QUEUE_NAMES.integrations,
  (job) => processor.process(job),
  { connection: redisConnection.duplicate() },
);

describe('Blogger BullMQ synchronization', () => {
  let workspaceId: string;
  let websiteId: string;
  let connectionId: string;

  beforeAll(async () => {
    await database.workspace.deleteMany({ where: { slug: 'phase2-worker-sync' } });
    await database.user.deleteMany({ where: { email: 'worker-sync@phase2.test' } });
    const user = await database.user.create({
      data: {
        email: 'worker-sync@phase2.test',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture',
        mustChangePassword: false,
      },
    });
    const workspace = await database.workspace.create({
      data: { name: 'Phase 2 Worker', slug: 'phase2-worker-sync' },
    });
    workspaceId = workspace.id;
    await database.workspaceMember.create({
      data: { userId: user.id, workspaceId, role: WorkspaceRole.OWNER },
    });
    const website = await database.website.create({
      data: {
        workspaceId,
        name: 'Worker Blogger',
        slug: 'worker-blogger',
        platform: WebsitePlatform.BLOGGER,
        language: 'ar',
        timezone: 'Africa/Casablanca',
        status: WebsiteStatus.ACTIVE,
      },
    });
    websiteId = website.id;
    const connection = await database.websiteConnection.create({
      data: {
        workspaceId,
        websiteId,
        provider: PublishingProviderType.BLOGGER,
        mode: IntegrationMode.MOCK,
        status: WebsiteConnectionStatus.CONNECTED,
        externalAccountId: 'mock-google-account-001',
        externalSiteId: 'mock-blog-sports-001',
        externalSiteName: 'Blog sportif Mock',
        externalSiteUrl: 'https://sports-mock.example.test',
        connectedByUserId: user.id,
        connectedAt: new Date(),
      },
    });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await worker.close();
    await queue.obliterate({ force: true });
    await events.close();
    await queue.close();
    await redisConnection.quit();
    await database.workspace.deleteMany({ where: { slug: 'phase2-worker-sync' } });
    await database.user.deleteMany({ where: { email: 'worker-sync@phase2.test' } });
    await database.disconnect();
  });

  async function synchronize() {
    const correlationId = randomUUID();
    const run = await database.integrationSyncRun.create({
      data: { workspaceId, websiteId, connectionId, correlationId },
    });
    const job = await queue.add(
      JOB_NAMES.bloggerSyncSite,
      { syncRunId: run.id, workspaceId, websiteId, connectionId, correlationId },
      { jobId: run.id, attempts: 2, backoff: { type: 'exponential', delay: 10 } },
    );
    const result = (await job.waitUntilFinished(events, 10_000)) as unknown;
    return {
      correlationId,
      result,
      runId: run.id,
    };
  }

  it('imports all paginated posts and labels through a real BullMQ job', async () => {
    const sync = await synchronize();
    expect(sync.result).toMatchObject({
      status: 'COMPLETED',
      correlationId: sync.correlationId,
      itemsProcessed: 4,
      itemsCreated: 4,
    });
    expect(await database.externalPost.count({ where: { connectionId } })).toBe(4);
    expect(await database.externalTaxonomyTerm.count({ where: { connectionId } })).toBeGreaterThan(
      1,
    );
    const run = await database.integrationSyncRun.findUniqueOrThrow({
      where: { id: sync.runId },
    });
    expect(run.status).toBe('COMPLETED');
    expect(run.cursor).toBeNull();
  });

  it('repeats idempotently without duplicate external posts and preserves correlation IDs', async () => {
    const sync = await synchronize();
    expect(sync.result).toMatchObject({
      status: 'COMPLETED',
      correlationId: sync.correlationId,
      itemsCreated: 0,
      itemsUpdated: 4,
    });
    expect(await database.externalPost.count({ where: { connectionId } })).toBe(4);
    expect(
      await database.auditLog.count({
        where: { workspaceId, action: 'blogger.sync.completed' },
      }),
    ).toBe(2);
  });

  it('retries rate limits but completes permanent permission failures without an endless retry', async () => {
    await database.websiteConnection.update({
      where: { id: connectionId },
      data: { metadata: { simulation: 'RATE_LIMIT' } },
    });
    const limited = await synchronize();
    expect(limited.result).toMatchObject({
      status: 'FAILED',
      errorCode: 'BLOGGER_RATE_LIMITED',
    });
    const limitedJob = await queue.getJob(limited.runId);
    expect(limitedJob?.attemptsMade).toBe(2);

    await database.websiteConnection.update({
      where: { id: connectionId },
      data: { metadata: { simulation: 'PERMISSION_DENIED' } },
    });
    const denied = await synchronize();
    expect(denied.result).toMatchObject({
      status: 'FAILED',
      errorCode: 'BLOGGER_PERMISSION_DENIED',
    });
    const deniedJob = await queue.getJob(denied.runId);
    expect(deniedJob?.attemptsMade).toBe(1);
    await database.websiteConnection.update({
      where: { id: connectionId },
      data: { metadata: {} },
    });
  });
});
