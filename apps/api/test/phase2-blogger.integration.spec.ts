import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DatabaseService,
  UserStatus,
  WebsiteConnectionStatus,
  WebsitePlatform,
  WebsiteStatus,
  WorkspaceRole,
} from '@ai-content-os/database';
import { ProviderError } from '@ai-content-os/integrations';
import { argon2id, hash } from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { BloggerProviderFactory } from '../src/modules/integrations/blogger-provider.factory';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required for Phase 2 tests.');
}

describe('Phase 2 Blogger API integration', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let workspaceA: string;
  let workspaceB: string;
  let websiteA: string;
  let websiteB: string;
  let ownerToken: string;
  let viewerToken: string;
  let inactiveToken: string;
  const password = 'Phase2-Integration-9472';

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
    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase2-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase2.test' } } });
    const passwordHash = await hash(password, { type: argon2id });
    const [owner, viewer, inactive] = await Promise.all([
      database.user.create({
        data: { email: 'owner@phase2.test', passwordHash, mustChangePassword: false },
      }),
      database.user.create({
        data: { email: 'viewer@phase2.test', passwordHash, mustChangePassword: false },
      }),
      database.user.create({
        data: { email: 'inactive@phase2.test', passwordHash, mustChangePassword: false },
      }),
    ]);
    const [a, b] = await Promise.all([
      database.workspace.create({ data: { name: 'Phase 2 A', slug: 'phase2-a' } }),
      database.workspace.create({ data: { name: 'Phase 2 B', slug: 'phase2-b' } }),
    ]);
    workspaceA = a.id;
    workspaceB = b.id;
    await Promise.all([
      database.workspaceMember.create({
        data: { userId: owner.id, workspaceId: a.id, role: WorkspaceRole.OWNER },
      }),
      database.workspaceMember.create({
        data: { userId: viewer.id, workspaceId: a.id, role: WorkspaceRole.VIEWER },
      }),
      database.workspaceMember.create({
        data: { userId: owner.id, workspaceId: b.id, role: WorkspaceRole.OWNER },
      }),
      database.workspaceMember.create({
        data: { userId: inactive.id, workspaceId: a.id, role: WorkspaceRole.ADMIN },
      }),
    ]);
    const [siteA, siteB] = await Promise.all([
      database.website.create({
        data: {
          workspaceId: a.id,
          name: 'Phase 2 Blogger A',
          slug: 'blogger-a',
          platform: WebsitePlatform.BLOGGER,
          language: 'ar',
          timezone: 'Africa/Casablanca',
          status: WebsiteStatus.ACTIVE,
        },
      }),
      database.website.create({
        data: {
          workspaceId: b.id,
          name: 'Phase 2 Blogger B',
          slug: 'blogger-b',
          platform: WebsitePlatform.BLOGGER,
          language: 'en',
          timezone: 'UTC',
          status: WebsiteStatus.ACTIVE,
        },
      }),
    ]);
    websiteA = siteA.id;
    websiteB = siteB.id;
    const login = async (email: string) =>
      (await request(server).post('/api/v1/auth/login').send({ email, password }).expect(200)).body
        .accessToken as string;
    ownerToken = await login(owner.email);
    viewerToken = await login(viewer.email);
    inactiveToken = await login(inactive.email);
    await database.user.update({
      where: { id: inactive.id },
      data: { status: UserStatus.INACTIVE },
    });
  }, 60_000);

  afterAll(async () => {
    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase2-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase2.test' } } });
    await app.close();
  });

  const scoped = (workspaceId: string, websiteId: string) =>
    `/api/v1/workspaces/${workspaceId}/websites/${websiteId}`;

  it('exposes a safe Mock status and enforces authentication, RBAC, tenant isolation, and inactive users', async () => {
    const status = await request(server).get('/api/v1/integrations/status').expect(200);
    expect(status.body).toEqual({
      bloggerMode: 'MOCK',
      publicPublishEnabled: true,
      deleteEnabled: true,
    });
    expect(status.headers['cache-control']).toBe('no-store, private');
    expect(JSON.stringify(status.body)).not.toMatch(/token|secret|credential/i);
    await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations`)
      .expect(401);
    await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/connect`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({})
      .expect(403);
    await request(server)
      .get(`${scoped(workspaceA, websiteB)}/integrations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/sync`)
      .set('Authorization', `Bearer ${inactiveToken}`)
      .expect(403);
  });

  it('runs the one-time Mock OAuth journey, validates redirects, discovers blogs, and selects one', async () => {
    const invalidRedirect = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/connect`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ redirectAfter: 'https://evil.example.test/callback' })
      .expect(400);
    expect(invalidRedirect.body.error.code).toBe('VALIDATION_ERROR');
    const started = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/connect`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        redirectAfter: `/espaces/${workspaceA}/sites/${websiteA}/integrations/blogger/selection`,
      })
      .expect(201);
    const authorizationUrl = new URL(started.body.authorizationUrl as string);
    const state = authorizationUrl.searchParams.get('state');
    const code = authorizationUrl.searchParams.get('code');
    expect(state).toBeTruthy();
    expect(code).toBeTruthy();
    const invalidIssuer = await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({ state, code, iss: 'https://accounts.example.test' })
      .expect(400);
    expect(invalidIssuer.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(invalidIssuer.body)).not.toContain(state);
    expect(JSON.stringify(invalidIssuer.body)).not.toContain(code);
    const unknownProperty = await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({ state, code, unexpected: 'rejected' })
      .expect(400);
    expect(unknownProperty.body.error.code).toBe('VALIDATION_ERROR');
    await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({
        state,
        code,
        scope: 'https://www.googleapis.com/auth/blogger',
        iss: 'https://accounts.google.com',
        authuser: '0',
        prompt: 'consent',
      })
      .expect(302);
    const replay = await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({ state, code, iss: 'https://accounts.google.com' })
      .expect(400);
    expect(replay.body.error.code).toBe('INTEGRATION_OAUTH_STATE_REUSED');
    expect(JSON.stringify(replay.body)).not.toContain(state);
    expect(JSON.stringify(replay.body)).not.toContain(code);
    const invalidState = 'invalid-oauth-state-value-0001';
    const invalidStateResponse = await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({
        state: invalidState,
        code: 'invalid-state-secret-code',
        iss: 'https://accounts.google.com',
      })
      .expect(400);
    expect(invalidStateResponse.body.error.code).toBe('INTEGRATION_OAUTH_STATE_INVALID');
    expect(JSON.stringify(invalidStateResponse.body)).not.toContain(invalidState);
    expect(JSON.stringify(invalidStateResponse.body)).not.toContain('invalid-state-secret-code');
    const sites = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/sites?pageSize=1`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(sites.body.items).toHaveLength(1);
    expect(sites.body.nextPageToken).toBeTruthy();
    expect(sites.headers['cache-control']).toBe('no-store, private');
    await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/select-site`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ externalSiteId: 'untrusted-blog-id' })
      .expect(404);
    const selected = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/select-site`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ externalSiteId: 'mock-blog-sports-001' })
      .expect(201);
    expect(selected.body.externalSiteId).toBe('mock-blog-sports-001');
    expect(selected.body).not.toHaveProperty('encryptedCredentials');
  });

  it('tests the connection and performs idempotent draft CRUD with validation and audit', async () => {
    await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    const payload = {
      title: 'Brouillon Phase 2',
      htmlContent: '<p>Validation Mock</p>',
      labels: ['phase-2', 'mock'],
      idempotencyKey: 'phase2-create-0001',
    };
    const first = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload)
      .expect(201);
    const repeated = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload)
      .expect(201);
    expect(repeated.body.post.externalPostId).toBe(first.body.post.externalPostId);
    const conflict = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...payload, title: 'Différent' })
      .expect(409);
    expect(conflict.body.error.code).toBe('BLOGGER_DUPLICATE_OPERATION');
    await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...payload,
        idempotencyKey: 'phase2-script-0001',
        htmlContent: '<script>x()</script>',
      })
      .expect(400);
    const postId = first.body.post.externalPostId as string;
    await request(server)
      .patch(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts/${postId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...payload, title: 'Brouillon mis à jour', idempotencyKey: 'phase2-update-0001' })
      .expect(200);
    await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts/${postId}/publish`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: 'phase2-publish-0001' })
      .expect(201);
    await request(server)
      .delete(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts/${postId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: 'phase2-delete-0001' })
      .expect(204);
    expect(
      await database.auditLog.count({
        where: { workspaceId: workspaceA, action: { startsWith: 'blogger.' } },
      }),
    ).toBeGreaterThanOrEqual(6);
  });

  it('prevents an external blog from being attached to a second active connection', async () => {
    const started = await request(server)
      .post(`${scoped(workspaceB, websiteB)}/integrations/blogger/connect`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    const authorizationUrl = new URL(started.body.authorizationUrl as string);
    await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({
        state: authorizationUrl.searchParams.get('state'),
        code: authorizationUrl.searchParams.get('code'),
      })
      .expect(302);
    const duplicate = await request(server)
      .post(`${scoped(workspaceB, websiteB)}/integrations/blogger/select-site`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ externalSiteId: 'mock-blog-sports-001' })
      .expect(409);
    expect(duplicate.body.error.code).toBe('BLOGGER_DUPLICATE_OPERATION');
  });

  it('expires an unrecoverable connection, creates a fresh bound OAuth state, and disconnects locally', async () => {
    const providers = app.get(BloggerProviderFactory);
    const connection = await database.websiteConnection.findFirstOrThrow({
      where: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        revokedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    const encryptedCredentials = providers.encryption.encrypt({
      accessToken: 'expired-access-token-must-not-leak',
      refreshToken: 'expired-refresh-token-must-not-leak',
      scopes: ['https://www.googleapis.com/auth/blogger'],
    });
    await database.websiteConnection.update({
      where: { id: connection.id },
      data: {
        status: WebsiteConnectionStatus.CONNECTED,
        encryptedCredentials,
        credentialKeyVersion: providers.encryption.keyVersion,
      },
    });
    const mockProvider = providers.forMode('MOCK');
    const discovery = vi
      .spyOn(mockProvider, 'listSites')
      .mockRejectedValueOnce(
        new ProviderError(
          'BLOGGER_ACCOUNT_UNAUTHORIZED',
          'Google authorization failed.',
          false,
          401,
          'invalidCredentials',
        ),
      );
    const unauthorized = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/sites`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(401);
    discovery.mockRestore();
    expect(unauthorized.body.error.code).toBe('BLOGGER_ACCOUNT_UNAUTHORIZED');
    expect(JSON.stringify(unauthorized.body)).not.toMatch(
      /expired-access-token-must-not-leak|expired-refresh-token-must-not-leak/,
    );
    const expired = await database.websiteConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    expect(expired.status).toBe(WebsiteConnectionStatus.EXPIRED);
    expect(expired.lastErrorCode).toBe('BLOGGER_ACCOUNT_UNAUTHORIZED');
    expect(expired.encryptedCredentials).toBe(encryptedCredentials);
    expect(expired.credentialKeyVersion).toBe(providers.encryption.keyVersion);

    const previousStateHashes = new Set(
      (
        await database.oAuthState.findMany({
          where: { workspaceId: workspaceA, websiteId: websiteA },
          select: { stateHash: true },
        })
      ).map(({ stateHash }) => stateHash),
    );
    const reconnect = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/connect`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        redirectAfter: `/espaces/${workspaceA}/sites/${websiteA}/integrations/blogger`,
        replaceExisting: true,
      })
      .expect(201);
    const authorizationUrl = new URL(reconnect.body.authorizationUrl as string);
    const state = authorizationUrl.searchParams.get('state');
    const code = authorizationUrl.searchParams.get('code');
    expect(state).toBeTruthy();
    expect(code).toBeTruthy();
    const stateHash = createHash('sha256').update(state!).digest('hex');
    expect(previousStateHashes.has(stateHash)).toBe(false);
    const storedState = await database.oAuthState.findUniqueOrThrow({ where: { stateHash } });
    expect(storedState).toMatchObject({
      workspaceId: workspaceA,
      websiteId: websiteA,
      userId: connection.connectedByUserId,
      consumedAt: null,
    });

    await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({ state, code })
      .expect(302);
    const localConnection = await database.websiteConnection.findFirstOrThrow({
      where: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        revokedAt: null,
        status: WebsiteConnectionStatus.CONNECTED,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(localConnection.encryptedCredentials).toBeNull();
    const [postCount, auditCount] = await Promise.all([
      database.externalPost.count({ where: { workspaceId: workspaceA, websiteId: websiteA } }),
      database.auditLog.count({ where: { workspaceId: workspaceA, websiteId: websiteA } }),
    ]);
    const providerLookup = vi.spyOn(providers, 'forMode');
    await request(server)
      .delete(`${scoped(workspaceA, websiteA)}/integrations/blogger`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    expect(providerLookup).not.toHaveBeenCalled();
    providerLookup.mockRestore();
    expect(
      await database.externalPost.count({
        where: { workspaceId: workspaceA, websiteId: websiteA },
      }),
    ).toBe(postCount);
    expect(
      await database.auditLog.count({ where: { workspaceId: workspaceA, websiteId: websiteA } }),
    ).toBeGreaterThan(auditCount);
    expect(
      await database.website.findFirst({ where: { id: websiteA, workspaceId: workspaceA } }),
    ).not.toBeNull();
    const disconnected = await database.websiteConnection.findUniqueOrThrow({
      where: { id: localConnection.id },
    });
    expect(disconnected.status).toBe(WebsiteConnectionStatus.DISCONNECTED);
    expect(disconnected.revokedAt).not.toBeNull();
  });
});
