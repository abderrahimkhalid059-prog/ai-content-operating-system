import type { Server } from 'node:http';
import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DatabaseService,
  UserStatus,
  WebsitePlatform,
  WebsiteStatus,
  WorkspaceRole,
} from '@ai-content-os/database';
import { argon2id, hash } from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';

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
    await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({ state, code })
      .expect(302);
    const replay = await request(server)
      .get('/api/v1/integrations/blogger/callback')
      .query({ state, code })
      .expect(400);
    expect(replay.body.error.code).toBe('INTEGRATION_OAUTH_STATE_REUSED');
    const sites = await request(server)
      .get(`${scoped(workspaceA, websiteA)}/integrations/blogger/sites?pageSize=1`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(sites.body.items).toHaveLength(1);
    expect(sites.body.nextPageToken).toBeTruthy();
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
});
