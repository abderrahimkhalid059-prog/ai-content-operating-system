import type { Server } from 'node:http';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  ApiErrorResponse,
  ContentItemSummary,
  ContentRevisionSummary,
  PaginationResponse,
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
if (!databaseUrl || !redisUrl) {
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required for Phase 3A tests.');
}

describe('Phase 3A content API integration', () => {
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
  let writerId: string;
  let outsiderId: string;
  const password = 'Phase-3A-Password-9472';

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

    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase3a-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase3a.test' } } });
    const passwordHash = await hash(password, { type: argon2id });
    const users = await Promise.all(
      ['owner', 'writer', 'reviewer', 'viewer', 'outsider'].map((name) =>
        database.user.create({
          data: {
            email: `${name}@phase3a.test`,
            displayName: name,
            passwordHash,
            mustChangePassword: false,
          },
        }),
      ),
    );
    const [owner, writer, reviewer, viewer, outsider] = users;
    if (!owner || !writer || !reviewer || !viewer || !outsider) {
      throw new Error('Expected all Phase 3A fixture users.');
    }
    writerId = writer.id;
    outsiderId = outsider.id;
    const first = await database.workspace.create({
      data: { name: 'Phase 3A A', slug: 'phase3a-a' },
    });
    const second = await database.workspace.create({
      data: { name: 'Phase 3A B', slug: 'phase3a-b' },
    });
    workspaceA = first.id;
    workspaceB = second.id;
    await database.workspaceMember.createMany({
      data: [
        { workspaceId: first.id, userId: owner.id, role: WorkspaceRole.OWNER },
        { workspaceId: first.id, userId: writer.id, role: WorkspaceRole.WRITER },
        { workspaceId: first.id, userId: reviewer.id, role: WorkspaceRole.REVIEWER },
        { workspaceId: first.id, userId: viewer.id, role: WorkspaceRole.VIEWER },
        { workspaceId: second.id, userId: outsider.id, role: WorkspaceRole.OWNER },
      ],
    });
    const siteA = await database.website.create({
      data: {
        workspaceId: first.id,
        name: 'Site A',
        slug: 'site-a',
        platform: WebsitePlatform.OTHER,
        language: 'fr',
        timezone: 'UTC',
        status: WebsiteStatus.ACTIVE,
      },
    });
    const siteB = await database.website.create({
      data: {
        workspaceId: second.id,
        name: 'Site B',
        slug: 'site-b',
        platform: WebsitePlatform.OTHER,
        language: 'fr',
        timezone: 'UTC',
        status: WebsiteStatus.ACTIVE,
      },
    });
    websiteA = siteA.id;
    websiteB = siteB.id;
    const [firstProfile, secondProfile] = await Promise.all([
      database.contentProfile.create({
        data: {
          workspaceId: first.id,
          websiteId: siteA.id,
          name: 'Profil A',
          language: 'fr',
          tone: 'Clair',
          editorialRules: {},
        },
      }),
      database.contentProfile.create({
        data: {
          workspaceId: second.id,
          websiteId: siteB.id,
          name: 'Profil B',
          language: 'fr',
          tone: 'Clair',
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
    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase3a-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase3a.test' } } });
    await redis.quit();
    await app.close();
  });

  async function token(name: string): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${name}@phase3a.test`, password })
      .expect(200);
    return responseBody<{ accessToken: string }>(response).accessToken;
  }

  function responseBody<T>(response: request.Response): T {
    return (response as unknown as { body: T }).body;
  }

  function base(workspace = workspaceA, website = websiteA): string {
    return `/api/v1/workspaces/${workspace}/websites/${website}/contents`;
  }

  function draft(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Guide éditorial sécurisé',
      slug: 'guide-editorial-securise',
      excerpt: 'Un résumé contrôlé.',
      htmlContent: '<h1>Guide</h1><p class="retiree">Un contenu éditorial sûr.</p>',
      language: 'fr',
      locale: 'fr-FR',
      labels: ['SEO', ' seo ', 'Actualité'],
      editorialStatus: 'DRAFT',
      contentProfileId: profileA,
      ...overrides,
    };
  }

  it('creates tenant-scoped content, sanitizes it, computes metrics, audits safely, and lists it', async () => {
    const ownerToken = await token('owner');
    const created = await request(server)
      .post(base())
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(draft())
      .expect(201);
    const createdBody = responseBody<ContentItemSummary>(created);
    expect(createdBody.slug).toBe('guide-editorial-securise');
    expect(createdBody.htmlContent).toBe('<h1>Guide</h1><p>Un contenu éditorial sûr.</p>');
    expect(createdBody.labels).toEqual(['actualité', 'seo']);
    expect(createdBody.wordCount).toBeGreaterThan(0);
    expect(createdBody.publicationStatus).toBe('NOT_PUBLISHED');
    expect(await database.contentRevision.count({ where: { contentItemId: createdBody.id } })).toBe(
      1,
    );

    const duplicate = await request(server)
      .post(base())
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(draft())
      .expect(409);
    expect(responseBody<ApiErrorResponse>(duplicate).error.code).toBe('CONTENT_SLUG_CONFLICT');

    const unsafe = await request(server)
      .post(base())
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(draft({ slug: 'unsafe', htmlContent: '<p onclick="x()">Interdit</p>' }))
      .expect(400);
    expect(responseBody<ApiErrorResponse>(unsafe).error.code).toBe('CONTENT_HTML_UNSAFE');

    const list = await request(server)
      .get(`${base()}?search=Guide&editorialStatus=DRAFT&page=1&pageSize=1`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const listBody = responseBody<PaginationResponse<ContentItemSummary>>(list);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.pagination.total).toBeGreaterThanOrEqual(1);
    const audits = await database.auditLog.findMany({
      where: { targetId: createdBody.id },
    });
    expect(audits.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['content.created', 'content.revision_created']),
    );
    expect(JSON.stringify(audits.map((entry) => entry.metadata))).not.toContain('<h1>');
  });

  it('creates immutable revisions, rejects stale updates, and enforces transitions', async () => {
    const ownerToken = await token('owner');
    const created = await request(server)
      .post(base())
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(draft({ slug: 'versionne' }))
      .expect(201);
    const createdBody = responseBody<ContentItemSummary>(created);
    const updated = await request(server)
      .patch(`${base()}/${createdBody.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: 1, title: 'Guide version deux', changeReason: 'Clarification' })
      .expect(200);
    expect(responseBody<ContentItemSummary>(updated).version).toBe(2);
    const stale = await request(server)
      .patch(`${base()}/${createdBody.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: 1, title: 'Écriture obsolète' })
      .expect(409);
    expect(responseBody<ApiErrorResponse>(stale).error.code).toBe('CONTENT_STALE_UPDATE');
    const invalid = await request(server)
      .post(`${base()}/${createdBody.id}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: 2, nextStatus: 'PUBLISHED' })
      .expect(409);
    expect(responseBody<ApiErrorResponse>(invalid).error.code).toBe('CONTENT_INVALID_TRANSITION');
    await request(server)
      .post(`${base()}/${createdBody.id}/transition`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ expectedVersion: 2, nextStatus: 'IN_REVIEW' })
      .expect(201);
    const revisions = await request(server)
      .get(`${base()}/${createdBody.id}/revisions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      responseBody<ContentRevisionSummary[]>(revisions).map((revision) => revision.revisionNumber),
    ).toEqual([3, 2, 1]);
  });

  it('rejects cross-tenant resources and invalid profile or assignment references', async () => {
    const ownerToken = await token('owner');
    await request(server)
      .post(base())
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(draft({ slug: 'bad-profile', contentProfileId: profileB }))
      .expect(400);
    await request(server)
      .post(base())
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(draft({ slug: 'bad-assignee', assignedToUserId: outsiderId }))
      .expect(400);
    await request(server)
      .get(base(workspaceB, websiteB))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    const outsiderToken = await token('outsider');
    await request(server)
      .get(base(workspaceA, websiteA))
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
  });

  it('enforces Viewer, Writer, and Reviewer editorial capabilities', async () => {
    const ownerToken = await token('owner');
    const created = await request(server)
      .post(base())
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(draft({ slug: 'roles', assignedToUserId: writerId }))
      .expect(201);
    const createdBody = responseBody<ContentItemSummary>(created);
    const viewerToken = await token('viewer');
    await request(server)
      .post(base())
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(draft({ slug: 'viewer-forbidden' }))
      .expect(403);
    await request(server)
      .get(`${base()}/${createdBody.id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const writerToken = await token('writer');
    const unassigned = await request(server)
      .post(base())
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(draft({ slug: 'not-writer-owned' }))
      .expect(201);
    await request(server)
      .post(`${base()}/${responseBody<ContentItemSummary>(unassigned).id}/transition`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send({ expectedVersion: 1, nextStatus: 'IN_REVIEW' })
      .expect(403);
    const writerUpdate = await request(server)
      .patch(`${base()}/${createdBody.id}`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send({ expectedVersion: 1, title: 'Révision du rédacteur' })
      .expect(200);
    await request(server)
      .post(`${base()}/${createdBody.id}/transition`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send({
        expectedVersion: responseBody<ContentItemSummary>(writerUpdate).version,
        nextStatus: 'IN_REVIEW',
      })
      .expect(201);
    const reviewerToken = await token('reviewer');
    await request(server)
      .patch(`${base()}/${createdBody.id}`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ expectedVersion: 3, title: 'Mutation interdite' })
      .expect(403);
    await request(server)
      .post(`${base()}/${createdBody.id}/transition`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ expectedVersion: 3, nextStatus: 'APPROVED', reason: 'Conforme' })
      .expect(201);
  });
});
