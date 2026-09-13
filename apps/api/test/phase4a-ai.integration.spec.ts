import type { Server } from 'node:http';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AiConfigurationSummary,
  AiProviderTestResult,
  AiRunSummary,
  ResolvedAiConfiguration,
} from '@ai-content-os/contracts';
import {
  DatabaseService,
  WebsitePlatform,
  WebsiteStatus,
  WorkspaceRole,
} from '@ai-content-os/database';
import { argon2id, hash } from 'argon2';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl)
  throw new Error('Phase 4A integration database and Redis are required.');

describe('Phase 4A AI infrastructure API integration', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let redis: Redis;
  let workspaceA: string;
  let workspaceB: string;
  let websiteA: string;
  let websiteB: string;
  let profileA: string;
  let profileB: string;
  const password = 'Phase-4A-Password-9472';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.use(new RequestIdMiddleware().use.bind(new RequestIdMiddleware()));
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    redis = new Redis(redisUrl);

    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase4a-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase4a.test' } } });
    const passwordHash = await hash(password, { type: argon2id });
    const [owner, outsider] = await Promise.all(
      ['owner', 'outsider'].map((name) =>
        database.user.create({
          data: {
            email: `${name}@phase4a.test`,
            displayName: name,
            passwordHash,
            mustChangePassword: false,
          },
        }),
      ),
    );
    if (!owner || !outsider) throw new Error('Missing Phase 4A fixture users.');
    const [first, second] = await Promise.all([
      database.workspace.create({ data: { name: 'Phase 4A A', slug: 'phase4a-a' } }),
      database.workspace.create({ data: { name: 'Phase 4A B', slug: 'phase4a-b' } }),
    ]);
    workspaceA = first.id;
    workspaceB = second.id;
    await database.workspaceMember.createMany({
      data: [
        { workspaceId: workspaceA, userId: owner.id, role: WorkspaceRole.OWNER },
        { workspaceId: workspaceB, userId: outsider.id, role: WorkspaceRole.OWNER },
      ],
    });
    const [firstSite, secondSite] = await Promise.all([
      database.website.create({
        data: {
          workspaceId: workspaceA,
          name: 'Site A',
          slug: 'site-a',
          platform: WebsitePlatform.OTHER,
          language: 'en',
          timezone: 'UTC',
          status: WebsiteStatus.ACTIVE,
        },
      }),
      database.website.create({
        data: {
          workspaceId: workspaceB,
          name: 'Site B',
          slug: 'site-b',
          platform: WebsitePlatform.OTHER,
          language: 'es',
          timezone: 'UTC',
          status: WebsiteStatus.ACTIVE,
        },
      }),
    ]);
    websiteA = firstSite.id;
    websiteB = secondSite.id;
    const [firstProfile, secondProfile] = await Promise.all([
      database.contentProfile.create({
        data: {
          workspaceId: workspaceA,
          websiteId: websiteA,
          name: 'General A',
          language: 'en',
          tone: 'Clear',
          editorialRules: {},
        },
      }),
      database.contentProfile.create({
        data: {
          workspaceId: workspaceB,
          websiteId: websiteB,
          name: 'General B',
          language: 'es',
          tone: 'Claro',
          editorialRules: {},
        },
      }),
    ]);
    profileA = firstProfile.id;
    profileB = secondProfile.id;
  }, 60_000);

  beforeEach(async () => {
    const keys = await redis.keys('auth-rate:*');
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase4a-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase4a.test' } } });
    await redis.quit();
    await app.close();
  });

  async function token(name: 'owner' | 'outsider'): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${name}@phase4a.test`, password })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const endpoint = (workspace = workspaceA) => `/api/v1/workspaces/${workspace}/ai`;

  it('upserts idempotently, encrypts credentials, masks responses, and audits safely', async () => {
    const accessToken = await token('owner');
    const secret = 'phase4a-provider-secret-1234';
    const payload = {
      scope: 'WORKSPACE',
      providerKey: 'mock',
      model: 'mock-v1',
      credential: secret,
      timeoutMs: 500,
      maxRetries: 1,
      monthlyTokenLimit: 1000,
      pricingCurrency: 'usd',
      inputCostPerMillionMicros: 1000,
      outputCostPerMillionMicros: 2000,
    };
    const first = await request(server)
      .put(`${endpoint()}/configurations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(payload)
      .expect(200);
    const second = await request(server)
      .put(`${endpoint()}/configurations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...payload, credential: undefined, model: 'mock-v2' })
      .expect(200);
    const firstBody = first.body as AiConfigurationSummary;
    const secondBody = second.body as AiConfigurationSummary;
    if (!firstBody.id) throw new Error('Persisted configuration ID is required.');
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody).toMatchObject({ hasCredential: true, credentialHint: '••••1234' });
    expect(JSON.stringify(secondBody)).not.toContain(secret);
    const stored = await database.aiConfiguration.findUniqueOrThrow({
      where: { id: firstBody.id },
    });
    expect(stored.encryptedCredentials).toBeTruthy();
    expect(stored.encryptedCredentials).not.toContain(secret);
    const audits = await database.auditLog.findMany({ where: { targetId: firstBody.id } });
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['ai.configuration.created', 'ai.configuration.updated']),
    );
    expect(JSON.stringify(audits)).not.toContain(secret);
  });

  it('resolves profile, site, workspace, then safe system precedence', async () => {
    const accessToken = await token('owner');
    const outsiderToken = await token('outsider');
    for (const configuration of [
      {
        scope: 'WORKSPACE',
        providerKey: 'mock',
        model: 'workspace-model',
        monthlyTokenLimit: 1000,
        pricingCurrency: 'USD',
        inputCostPerMillionMicros: 1_000_000,
        outputCostPerMillionMicros: 1_000_000,
      },
      { scope: 'WEBSITE', websiteId: websiteA, providerKey: 'mock', model: 'site-model' },
      {
        scope: 'CONTENT_PROFILE',
        websiteId: websiteA,
        contentProfileId: profileA,
        providerKey: 'mock',
        model: 'profile-model',
      },
    ]) {
      await request(server)
        .put(`${endpoint()}/configurations`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(configuration)
        .expect(200);
    }
    const profile = await request(server)
      .get(
        `${endpoint()}/resolved-configuration?websiteId=${websiteA}&contentProfileId=${profileA}`,
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((profile.body as ResolvedAiConfiguration).model).toBe('profile-model');
    const site = await request(server)
      .get(`${endpoint()}/resolved-configuration?websiteId=${websiteA}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((site.body as ResolvedAiConfiguration).model).toBe('site-model');
    const system = await request(server)
      .get(`${endpoint(workspaceB)}/resolved-configuration`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);
    expect(system.body as ResolvedAiConfiguration).toMatchObject({
      source: 'SYSTEM',
      providerKey: 'mock',
      model: 'mock-v1',
    });
  });

  it('executes only a safe provider probe and durably records usage and cost', async () => {
    const accessToken = await token('owner');
    const configurations = await request(server)
      .get(`${endpoint()}/configurations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const workspaceConfiguration = (configurations.body as AiConfigurationSummary[]).find(
      ({ scope }) => scope === 'WORKSPACE',
    );
    expect(workspaceConfiguration?.id).toBeTruthy();
    const tested = await request(server)
      .post(`${endpoint()}/configurations/${workspaceConfiguration!.id}/test`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-request-id', 'phase4a-safe-correlation')
      .expect(201);
    const result = tested.body as AiProviderTestResult;
    expect(result.ok).toBe(true);
    expect(result.run).toMatchObject({
      operation: 'CONFIGURATION_TEST',
      status: 'COMPLETED',
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19,
      estimatedCostMicros: 19,
      costCurrency: 'USD',
      retryCount: 0,
      correlationId: 'phase4a-safe-correlation',
    });
    const runs = await request(server)
      .get(`${endpoint()}/runs`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((runs.body as AiRunSummary[])[0]).not.toHaveProperty('text');
    expect(JSON.stringify(runs.body)).not.toMatch(/Test provider|secret-1234/i);
  });

  it('rejects cross-workspace, cross-site profile, and unknown properties', async () => {
    const ownerToken = await token('owner');
    const outsiderToken = await token('outsider');
    await request(server)
      .get(`${endpoint(workspaceB)}/configurations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    await request(server)
      .put(`${endpoint()}/configurations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        scope: 'CONTENT_PROFILE',
        websiteId: websiteA,
        contentProfileId: profileB,
        providerKey: 'mock',
        model: 'invalid',
      })
      .expect(404);
    await request(server)
      .put(`${endpoint(workspaceB)}/configurations`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ scope: 'WEBSITE', websiteId: websiteA, providerKey: 'mock', model: 'invalid' })
      .expect(404);
    await request(server)
      .put(`${endpoint()}/configurations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ scope: 'WORKSPACE', providerKey: 'mock', model: 'mock-v1', arbitrary: true })
      .expect(400);
    const secret = 'must-not-appear-in-error-9087';
    const failed = await request(server)
      .put(`${endpoint()}/configurations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        scope: 'WORKSPACE',
        providerKey: 'unregistered',
        model: 'invalid',
        credential: secret,
      })
      .expect(400);
    expect(JSON.stringify(failed.body)).not.toContain(secret);
  });
});
