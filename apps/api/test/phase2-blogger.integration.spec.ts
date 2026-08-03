import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { Logger, ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DatabaseService,
  ExternalPostStatus,
  IntegrationMode,
  ProviderPublicationOperation,
  ProviderPublicationStatus,
  PublishingProviderType,
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

  it('persists and recovers the controlled test draft with tenant-safe server-resolved mutations', async () => {
    await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    const originalConnection = await database.websiteConnection.findFirstOrThrow({
      where: { workspaceId: workspaceA, websiteId: websiteA, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
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
    const postId = first.body.post.externalPostId as string;
    const current = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(current.headers['cache-control']).toBe('no-store, private');
    expect(current.body).toMatchObject({
      publicationId: first.body.operationId,
      externalPostId: postId,
      title: payload.title,
      htmlContent: payload.htmlContent,
      labels: payload.labels,
      status: 'DRAFT',
    });
    expect(current.body.createdAt).toEqual(expect.any(String));
    expect(current.body.updatedAt).toEqual(expect.any(String));
    expect(JSON.stringify(current.body)).not.toMatch(
      /token|secret|credential|requestHash|idempotencyKey/i,
    );
    await request(server)
      .get(`${scoped(workspaceB, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    const conflict = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...payload, title: 'Différent' })
      .expect(409);
    expect(conflict.body.error.code).toBe('BLOGGER_DUPLICATE_OPERATION');
    const secondActiveDraft = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...payload,
        title: 'Second brouillon interdit',
        idempotencyKey: 'phase2-create-0002',
      })
      .expect(409);
    expect(secondActiveDraft.body.error.code).toBe('BLOGGER_DUPLICATE_OPERATION');
    expect(
      await database.externalPost.count({
        where: {
          workspaceId: workspaceA,
          websiteId: websiteA,
          status: ExternalPostStatus.DRAFT,
          deletedExternallyAt: null,
        },
      }),
    ).toBe(1);
    await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...payload,
        idempotencyKey: 'phase2-script-0001',
        htmlContent: '<script>x()</script>',
      })
      .expect(400);

    const arbitraryId = 'frontend-controlled-arbitrary-post-id';
    const rejectedUpdate = await request(server)
      .patch(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts/${arbitraryId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...payload,
        title: 'Tentative arbitraire',
        idempotencyKey: 'phase2-update-arbitrary',
      })
      .expect(400);
    expect(rejectedUpdate.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(rejectedUpdate.body)).not.toContain(postId);

    await request(server)
      .patch(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...payload, title: 'Brouillon mis à jour', idempotencyKey: 'phase2-update-0001' })
      .expect(200);
    const updated = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(updated.body).toMatchObject({
      publicationId: first.body.operationId,
      externalPostId: postId,
      title: 'Brouillon mis à jour',
      htmlContent: payload.htmlContent,
      labels: payload.labels,
      status: 'DRAFT',
    });
    expect(Date.parse(updated.body.updatedAt as string)).toBeGreaterThanOrEqual(
      Date.parse(current.body.updatedAt as string),
    );

    await database.externalPost.updateMany({
      where: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        connectionId: originalConnection.id,
        externalPostId: postId,
      },
      data: { status: ExternalPostStatus.PUBLISHED },
    });
    await database.externalPost.create({
      data: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        connectionId: originalConnection.id,
        provider: PublishingProviderType.BLOGGER,
        externalPostId: 'ordinary-imported-draft',
        externalBlogId: originalConnection.externalSiteId!,
        title: 'Imported draft must not be recovered',
        status: ExternalPostStatus.DRAFT,
        contentHash: 'a'.repeat(64),
        labels: [],
        lastImportedAt: new Date(),
      },
    });
    await database.providerPublication.create({
      data: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        connectionId: originalConnection.id,
        provider: PublishingProviderType.BLOGGER,
        idempotencyKey: 'phase2-failed-create-fixture',
        operationType: ProviderPublicationOperation.CREATE_DRAFT,
        externalPostId: 'failed-controlled-draft',
        requestHash: 'b'.repeat(64),
        status: ProviderPublicationStatus.FAILED,
        attemptCount: 1,
        lastAttemptAt: new Date(),
        safeErrorCode: 'BLOGGER_UPSTREAM_UNAVAILABLE',
      },
    });
    await database.providerPublication.createMany({
      data: [
        {
          workspaceId: workspaceA,
          websiteId: websiteA,
          connectionId: originalConnection.id,
          provider: PublishingProviderType.BLOGGER,
          idempotencyKey: 'phase2-deleted-create-fixture',
          operationType: ProviderPublicationOperation.CREATE_DRAFT,
          externalPostId: 'deleted-controlled-draft',
          requestHash: 'c'.repeat(64),
          status: ProviderPublicationStatus.COMPLETED,
          attemptCount: 1,
          lastAttemptAt: new Date(),
          completedAt: new Date(),
        },
        {
          workspaceId: workspaceA,
          websiteId: websiteA,
          connectionId: originalConnection.id,
          provider: PublishingProviderType.BLOGGER,
          idempotencyKey: 'phase2-deleted-delete-fixture',
          operationType: ProviderPublicationOperation.DELETE_POST,
          externalPostId: 'deleted-controlled-draft',
          requestHash: 'd'.repeat(64),
          status: ProviderPublicationStatus.COMPLETED,
          attemptCount: 1,
          lastAttemptAt: new Date(),
          completedAt: new Date(),
        },
      ],
    });
    await database.externalPost.create({
      data: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        connectionId: originalConnection.id,
        provider: PublishingProviderType.BLOGGER,
        externalPostId: 'deleted-controlled-draft',
        externalBlogId: originalConnection.externalSiteId!,
        title: 'Deleted controlled draft',
        status: ExternalPostStatus.DELETED,
        contentHash: 'e'.repeat(64),
        labels: [],
        lastImportedAt: new Date(),
        deletedExternallyAt: new Date(),
      },
    });

    const otherWebsite = await database.website.create({
      data: {
        workspaceId: workspaceA,
        name: 'Phase 2 Blogger isolation',
        slug: 'blogger-isolation',
        platform: WebsitePlatform.BLOGGER,
        language: 'fr',
        timezone: 'Africa/Casablanca',
        status: WebsiteStatus.ACTIVE,
      },
    });
    const isolationConnections = await Promise.all([
      database.websiteConnection.create({
        data: {
          workspaceId: workspaceA,
          websiteId: websiteA,
          provider: PublishingProviderType.BLOGGER,
          mode: IntegrationMode.MOCK,
          status: WebsiteConnectionStatus.DISCONNECTED,
          externalSiteId: 'mock-blog-travel-001',
          connectedByUserId: originalConnection.connectedByUserId,
          revokedAt: new Date(),
        },
      }),
      database.websiteConnection.create({
        data: {
          workspaceId: workspaceA,
          websiteId: otherWebsite.id,
          provider: PublishingProviderType.BLOGGER,
          mode: IntegrationMode.MOCK,
          status: WebsiteConnectionStatus.DISCONNECTED,
          externalSiteId: originalConnection.externalSiteId,
          connectedByUserId: originalConnection.connectedByUserId,
          revokedAt: new Date(),
        },
      }),
      database.websiteConnection.create({
        data: {
          workspaceId: workspaceB,
          websiteId: websiteB,
          provider: PublishingProviderType.BLOGGER,
          mode: IntegrationMode.MOCK,
          status: WebsiteConnectionStatus.DISCONNECTED,
          externalSiteId: originalConnection.externalSiteId,
          connectedByUserId: originalConnection.connectedByUserId,
          revokedAt: new Date(),
        },
      }),
    ]);
    await Promise.all(
      isolationConnections.map((fixtureConnection, index) =>
        database.providerPublication.create({
          data: {
            workspaceId: fixtureConnection.workspaceId,
            websiteId: fixtureConnection.websiteId,
            connectionId: fixtureConnection.id,
            provider: PublishingProviderType.BLOGGER,
            idempotencyKey: `phase2-isolated-create-${index}`,
            operationType: ProviderPublicationOperation.CREATE_DRAFT,
            externalPostId: `isolated-controlled-draft-${index}`,
            requestHash: String(index + 1).repeat(64),
            status: ProviderPublicationStatus.COMPLETED,
            attemptCount: 1,
            lastAttemptAt: new Date(),
            completedAt: new Date(),
          },
        }),
      ),
    );

    await request(server)
      .delete(`${scoped(workspaceA, websiteA)}/integrations/blogger`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    const reconnectStarted = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/connect`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    const reconnectUrl = new URL(reconnectStarted.body.authorizationUrl as string);
    await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({
        state: reconnectUrl.searchParams.get('state'),
        code: reconnectUrl.searchParams.get('code'),
      })
      .expect(302);
    await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/select-site`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ externalSiteId: originalConnection.externalSiteId })
      .expect(201);
    const reconnected = await database.websiteConnection.findFirstOrThrow({
      where: { workspaceId: workspaceA, websiteId: websiteA, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(reconnected.id).not.toBe(originalConnection.id);
    expect(reconnected.externalSiteId).toBe(originalConnection.externalSiteId);

    const diagnosticLog = vi.spyOn(Logger.prototype, 'log');
    const recovered = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-request-id', 'phase2-safe-recovery-request')
      .expect(200);
    const lookupDiagnostic = diagnosticLog.mock.calls
      .map(([message]) => message as unknown)
      .find(
        (message): message is Record<string, unknown> =>
          typeof message === 'object' && message !== null && 'candidatePublicationCount' in message,
      );
    diagnosticLog.mockRestore();
    expect(recovered.body).toMatchObject({
      publicationId: first.body.operationId,
      externalPostId: postId,
      title: 'Brouillon mis à jour',
      htmlContent: payload.htmlContent,
      labels: payload.labels,
      status: 'DRAFT',
    });
    expect(lookupDiagnostic).toMatchObject({
      selectedPublicationId: first.body.operationId,
      selectedConnectionId: originalConnection.id,
      externalSiteMatch: true,
      operationType: ProviderPublicationOperation.UPDATE_POST,
      publicationStatus: ProviderPublicationStatus.COMPLETED,
      requestId: 'phase2-safe-recovery-request',
    });
    expect(Number(lookupDiagnostic?.candidatePublicationCount)).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(lookupDiagnostic)).not.toMatch(/token|secret|credential|authorization/i);
    const noSecondDraftAfterReconnect = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...payload, idempotencyKey: 'phase2-create-after-reconnect' })
      .expect(409);
    expect(noSecondDraftAfterReconnect.body.error.code).toBe('BLOGGER_DUPLICATE_OPERATION');

    const rejectedDelete = await request(server)
      .delete(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts/${arbitraryId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: 'phase2-delete-arbitrary' })
      .expect(400);
    expect(rejectedDelete.body.error.code).toBe('VALIDATION_ERROR');
    await request(server)
      .delete(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: 'phase2-delete-0001' })
      .expect(204);
    const afterDelete = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(afterDelete.body).toBeNull();
    const locallyDeleted = await database.externalPost.findMany({
      where: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        externalPostId: postId,
      },
    });
    expect(locallyDeleted).toHaveLength(2);
    expect(
      locallyDeleted.every(
        ({ status, deletedExternallyAt }) =>
          status === ExternalPostStatus.DELETED && deletedExternallyAt !== null,
      ),
    ).toBe(true);

    const missingDraft = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...payload,
        title: 'Brouillon supprimé hors application',
        idempotencyKey: 'phase2-create-missing-0001',
      })
      .expect(201);
    const missingPostId = missingDraft.body.post.externalPostId as string;
    const providers = app.get(BloggerProviderFactory);
    const provider = providers.forMode('MOCK');
    const nonMissingProviderErrors = [
      [401, 'BLOGGER_ACCOUNT_UNAUTHORIZED', 401],
      [403, 'BLOGGER_PERMISSION_DENIED', 403],
      [429, 'BLOGGER_RATE_LIMITED', 429],
      [503, 'BLOGGER_UPSTREAM_UNAVAILABLE', 502],
    ] as const;
    for (const [providerStatus, errorCode, apiStatus] of nonMissingProviderErrors) {
      const providerFailure = vi
        .spyOn(provider, 'getPost')
        .mockRejectedValueOnce(
          new ProviderError(errorCode, 'safe-provider-error', false, providerStatus),
        );
      const response = await request(server)
        .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(apiStatus);
      providerFailure.mockRestore();
      expect(response.body.error.code).toBe(errorCode);
      const unchangedPost = await database.externalPost.findFirstOrThrow({
        where: {
          workspaceId: workspaceA,
          websiteId: websiteA,
          externalPostId: missingPostId,
        },
      });
      expect(unchangedPost.status).toBe(ExternalPostStatus.DRAFT);
      expect(unchangedPost.deletedExternallyAt).toBeNull();
      expect(
        await database.providerPublication.count({
          where: {
            workspaceId: workspaceA,
            websiteId: websiteA,
            externalPostId: missingPostId,
            idempotencyKey: `reconcile-missing-${missingDraft.body.operationId as string}`,
          },
        }),
      ).toBe(0);
    }
    const missingProviderPost = vi
      .spyOn(provider, 'getPost')
      .mockRejectedValueOnce(
        new ProviderError(
          'BLOGGER_POST_NOT_FOUND',
          'unsafe-provider-message-with-secret',
          false,
          404,
          'notFound',
        ),
      );
    const reconciled = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(410);
    missingProviderPost.mockRestore();
    expect(reconciled.body.error).toMatchObject({
      code: 'BLOGGER_POST_NOT_FOUND',
      message: 'Le brouillon de test n’existe plus dans Blogger. Son état local a été réconcilié.',
    });
    expect(JSON.stringify(reconciled.body)).not.toMatch(
      /unsafe-provider-message-with-secret|token|credential|requestHash/i,
    );
    const afterReconciliation = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(afterReconciliation.body).toMatchObject({
      publicationId: missingDraft.body.operationId,
      externalPostId: missingPostId,
      title: missingDraft.body.post.title,
      status: 'DRAFT',
    });
    const reconciledPost = await database.externalPost.findFirstOrThrow({
      where: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        externalPostId: missingPostId,
      },
    });
    expect(reconciledPost.status).toBe(ExternalPostStatus.DRAFT);
    expect(reconciledPost.deletedExternallyAt).toBeNull();
    const reconciliationOperation = await database.providerPublication.findFirstOrThrow({
      where: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        externalPostId: missingPostId,
        operationType: ProviderPublicationOperation.DELETE_POST,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(reconciliationOperation.status).toBe(ProviderPublicationStatus.COMPLETED);
    expect(reconciliationOperation.safeErrorCode).toBe('BLOGGER_POST_NOT_FOUND');
    expect(
      await database.auditLog.count({
        where: {
          workspaceId: workspaceA,
          websiteId: websiteA,
          action: 'blogger.test_draft.recovered_after_false_missing',
        },
      }),
    ).toBe(1);
    await request(server)
      .delete(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: 'phase2-delete-recovered-after-false-missing' })
      .expect(204);

    const publishableDraft = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-posts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ...payload,
        title: 'Brouillon publiable',
        idempotencyKey: 'phase2-create-publishable-0001',
      })
      .expect(201);
    const published = await request(server)
      .post(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current/publish`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ idempotencyKey: 'phase2-publish-0001' })
      .expect(201);
    expect(published.body.post.externalPostId).toBe(publishableDraft.body.post.externalPostId);
    const afterPublish = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/test-publication/current`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(afterPublish.body).toBeNull();
    expect(
      await database.auditLog.count({
        where: { workspaceId: workspaceA, action: { startsWith: 'blogger.' } },
      }),
    ).toBeGreaterThanOrEqual(10);
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
