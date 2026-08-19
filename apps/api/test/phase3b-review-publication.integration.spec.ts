import type { Server } from 'node:http';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  ApiErrorResponse,
  ContentCommentSummary,
  ContentItemSummary,
  ContentPublicationSummary,
  ContentReviewSummary,
  ReviewCenterResponse,
} from '@ai-content-os/contracts';
import {
  DatabaseService,
  IntegrationMode,
  WebsiteConnectionStatus,
  WebsitePlatform,
  WebsiteStatus,
  WorkspaceRole,
} from '@ai-content-os/database';
import { ProviderError } from '@ai-content-os/integrations';
import { argon2id, hash } from 'argon2';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { BloggerProviderFactory } from '../src/modules/integrations/blogger-provider.factory';

process.env.BLOGGER_ALLOW_PUBLIC_PUBLISH = 'false';
process.env.BLOGGER_ALLOW_DELETE = 'false';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required for Phase 3B tests.');
}

describe('Phase 3B review center and Blogger draft handoff', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let redis: Redis;
  let providers: BloggerProviderFactory;
  let workspaceA: string;
  let workspaceB: string;
  let websiteA: string;
  let websiteOther: string;
  let websiteB: string;
  let ownerId: string;
  let writerId: string;
  let connectionId: string;
  const password = 'Phase-3B-Password-9472';

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
    providers = app.get(BloggerProviderFactory);
    redis = new Redis(redisUrl);

    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase3b-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase3b.test' } } });
    const passwordHash = await hash(password, { type: argon2id });
    const users = await Promise.all(
      ['owner', 'editor', 'reviewer', 'writer', 'seo', 'viewer', 'outsider'].map((name) =>
        database.user.create({
          data: {
            email: `${name}@phase3b.test`,
            displayName: name,
            passwordHash,
            mustChangePassword: false,
          },
        }),
      ),
    );
    const [owner, editor, reviewer, writer, seo, viewer, outsider] = users;
    if (!owner || !editor || !reviewer || !writer || !seo || !viewer || !outsider) {
      throw new Error('Expected all Phase 3B fixture users.');
    }
    ownerId = owner.id;
    writerId = writer.id;
    const first = await database.workspace.create({
      data: { name: 'Phase 3B A', slug: 'phase3b-a' },
    });
    const second = await database.workspace.create({
      data: { name: 'Phase 3B B', slug: 'phase3b-b' },
    });
    workspaceA = first.id;
    workspaceB = second.id;
    await database.workspaceMember.createMany({
      data: [
        { workspaceId: first.id, userId: owner.id, role: WorkspaceRole.OWNER },
        { workspaceId: first.id, userId: editor.id, role: WorkspaceRole.EDITOR },
        { workspaceId: first.id, userId: reviewer.id, role: WorkspaceRole.REVIEWER },
        { workspaceId: first.id, userId: writer.id, role: WorkspaceRole.WRITER },
        { workspaceId: first.id, userId: seo.id, role: WorkspaceRole.SEO_MANAGER },
        { workspaceId: first.id, userId: viewer.id, role: WorkspaceRole.VIEWER },
        { workspaceId: second.id, userId: outsider.id, role: WorkspaceRole.OWNER },
      ],
    });
    const sites = await Promise.all([
      database.website.create({
        data: {
          workspaceId: first.id,
          name: 'Blogger principal',
          slug: 'blogger-principal',
          platform: WebsitePlatform.BLOGGER,
          language: 'fr',
          timezone: 'UTC',
          status: WebsiteStatus.ACTIVE,
        },
      }),
      database.website.create({
        data: {
          workspaceId: first.id,
          name: 'Autre site',
          slug: 'autre-site',
          platform: WebsitePlatform.OTHER,
          language: 'fr',
          timezone: 'UTC',
          status: WebsiteStatus.ACTIVE,
        },
      }),
      database.website.create({
        data: {
          workspaceId: second.id,
          name: 'Site étranger',
          slug: 'site-etranger',
          platform: WebsitePlatform.BLOGGER,
          language: 'fr',
          timezone: 'UTC',
          status: WebsiteStatus.ACTIVE,
        },
      }),
    ]);
    const [siteA, siteOther, siteB] = sites;
    if (!siteA || !siteOther || !siteB) throw new Error('Expected all Phase 3B sites.');
    websiteA = siteA.id;
    websiteOther = siteOther.id;
    websiteB = siteB.id;
    const connection = await database.websiteConnection.create({
      data: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        provider: 'BLOGGER',
        mode: IntegrationMode.MOCK,
        status: WebsiteConnectionStatus.CONNECTED,
        externalAccountId: 'mock-google-account-001',
        externalSiteId: 'mock-blog-sports-001',
        externalSiteName: 'مدونة رياضية تجريبية',
        connectedByUserId: owner.id,
        connectedAt: new Date(),
      },
    });
    connectionId = connection.id;
  }, 60_000);

  beforeEach(async () => {
    const keys = await redis.keys('auth-rate:*');
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase3b-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase3b.test' } } });
    await redis.quit();
    await app.close();
  });

  async function token(name: string): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${name}@phase3b.test`, password })
      .expect(200);
    return body<{ accessToken: string }>(response).accessToken;
  }

  function body<T>(response: request.Response): T {
    return (response as unknown as { body: T }).body;
  }

  function base(workspace = workspaceA, website = websiteA): string {
    return `/api/v1/workspaces/${workspace}/websites/${website}/contents`;
  }

  async function createContent(auth: string, slug: string): Promise<ContentItemSummary> {
    const response = await request(server)
      .post(base())
      .set('Authorization', `Bearer ${auth}`)
      .send({
        title: `Contenu ${slug}`,
        slug,
        htmlContent: `<h1>${slug}</h1><p>Version contrôlée.</p>`,
        language: 'fr',
        labels: ['Phase 3B', 'Blogger'],
        editorialStatus: 'DRAFT',
        assignedToUserId: writerId,
      })
      .expect(201);
    return body<ContentItemSummary>(response);
  }

  async function readyContent(auth: string, reviewerAuth: string, slug: string) {
    const created = await createContent(auth, slug);
    const submitted = await request(server)
      .post(`${base()}/${created.id}/transition`)
      .set('Authorization', `Bearer ${auth}`)
      .send({ expectedVersion: created.version, nextStatus: 'IN_REVIEW' })
      .expect(201);
    const inReview = body<ContentItemSummary>(submitted);
    await request(server)
      .post(`${base()}/${created.id}/reviews`)
      .set('Authorization', `Bearer ${reviewerAuth}`)
      .send({ reviewedRevisionNumber: inReview.version, decision: 'APPROVED' })
      .expect(201);
    const approved = await database.contentItem.findUniqueOrThrow({ where: { id: created.id } });
    const ready = await request(server)
      .post(`${base()}/${created.id}/transition`)
      .set('Authorization', `Bearer ${auth}`)
      .send({ expectedVersion: approved.version, nextStatus: 'READY_TO_PUBLISH' })
      .expect(201);
    return body<ContentItemSummary>(ready);
  }

  it('adds, lists, resolves, and reopens safe tenant-scoped comments', async () => {
    const owner = await token('owner');
    const reviewer = await token('reviewer');
    const item = await createContent(owner, 'commentaires');
    const created = await request(server)
      .post(`${base()}/${item.id}/comments`)
      .set('Authorization', `Bearer ${reviewer}`)
      .send({ message: 'Vérifier la source principale.' })
      .expect(201);
    const comment = body<ContentCommentSummary>(created);
    expect(comment.status).toBe('OPEN');
    await request(server)
      .post(`${base()}/${item.id}/comments/${comment.id}/resolve`)
      .set('Authorization', `Bearer ${reviewer}`)
      .expect(201);
    const reopened = await request(server)
      .post(`${base()}/${item.id}/comments/${comment.id}/reopen`)
      .set('Authorization', `Bearer ${reviewer}`)
      .expect(201);
    expect(body<ContentCommentSummary>(reopened).status).toBe('OPEN');
    const listed = await request(server)
      .get(`${base()}/${item.id}/comments`)
      .set('Authorization', `Bearer ${reviewer}`)
      .expect(200);
    expect(body<ContentCommentSummary[]>(listed)).toHaveLength(1);
    await request(server)
      .post(`${base()}/${item.id}/comments`)
      .set('Authorization', `Bearer ${reviewer}`)
      .send({ message: '<script>interdit</script>' })
      .expect(400);
    await request(server)
      .get(`${base(workspaceA, websiteOther)}/${item.id}/comments`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(404);
  });

  it('records immutable revision-bound decisions and rejects stale or unauthorized reviews', async () => {
    const owner = await token('owner');
    const reviewer = await token('reviewer');
    const writer = await token('writer');
    const viewer = await token('viewer');
    const item = await createContent(owner, 'decision');
    const submitted = await request(server)
      .post(`${base()}/${item.id}/transition`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedVersion: 1, nextStatus: 'IN_REVIEW' })
      .expect(201);
    const revision = body<ContentItemSummary>(submitted).version;
    await request(server)
      .post(`${base()}/${item.id}/reviews`)
      .set('Authorization', `Bearer ${writer}`)
      .send({ reviewedRevisionNumber: revision, decision: 'APPROVED' })
      .expect(403);
    await request(server)
      .post(`${base()}/${item.id}/reviews`)
      .set('Authorization', `Bearer ${viewer}`)
      .send({ reviewedRevisionNumber: revision, decision: 'APPROVED' })
      .expect(403);
    await request(server)
      .patch(`${base()}/${item.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedVersion: revision, title: 'Version plus récente' })
      .expect(200);
    const stale = await request(server)
      .post(`${base()}/${item.id}/reviews`)
      .set('Authorization', `Bearer ${reviewer}`)
      .send({ reviewedRevisionNumber: revision, decision: 'APPROVED' })
      .expect(409);
    expect(body<ApiErrorResponse>(stale).error.code).toBe('CONTENT_REVIEW_STALE');
    const current = await database.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    const missingNote = await request(server)
      .post(`${base()}/${item.id}/reviews`)
      .set('Authorization', `Bearer ${reviewer}`)
      .send({ reviewedRevisionNumber: current.version, decision: 'CHANGES_REQUESTED' })
      .expect(400);
    expect(body<ApiErrorResponse>(missingNote).error.code).toBe('CONTENT_REVIEW_NOTE_REQUIRED');
    const decision = await request(server)
      .post(`${base()}/${item.id}/reviews`)
      .set('Authorization', `Bearer ${reviewer}`)
      .send({
        reviewedRevisionNumber: current.version,
        decision: 'CHANGES_REQUESTED',
        note: 'Clarifier les preuves.',
      })
      .expect(201);
    expect(body<ContentReviewSummary>(decision).decision).toBe('CHANGES_REQUESTED');
    expect(await database.contentReview.count({ where: { contentItemId: item.id } })).toBe(1);
    expect(
      (await database.contentItem.findUniqueOrThrow({ where: { id: item.id } })).editorialStatus,
    ).toBe('CHANGES_REQUESTED');
  });

  it('builds bounded review queues with filters and tenant isolation', async () => {
    const owner = await token('owner');
    await createContent(owner, 'file-brouillon');
    const result = await request(server)
      .get(
        `/api/v1/workspaces/${workspaceA}/websites/${websiteA}/review-center?queue=TO_WRITE&language=fr&search=file&page=1&pageSize=1`,
      )
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    const center = body<ReviewCenterResponse>(result);
    expect(center.data).toHaveLength(1);
    expect(center.queueCounts.TO_WRITE).toBeGreaterThan(0);
    expect(center.pagination.pageSize).toBe(1);
    const outsider = await token('outsider');
    await request(server)
      .get(`/api/v1/workspaces/${workspaceA}/websites/${websiteA}/review-center`)
      .set('Authorization', `Bearer ${outsider}`)
      .expect(404);
  });

  it('creates one Blogger draft only for READY_TO_PUBLISH and persists safe synchronization', async () => {
    const owner = await token('owner');
    const reviewer = await token('reviewer');
    const draft = await createContent(owner, 'non-pret');
    await request(server)
      .post(`${base()}/${draft.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: draft.version, idempotencyKey: 'phase3b-not-ready' })
      .expect(409);
    const ready = await readyContent(owner, reviewer, 'handoff-initial');
    const key = 'phase3b-create-initial';
    const created = await request(server)
      .post(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: ready.version, idempotencyKey: key })
      .expect(201);
    const state = body<ContentPublicationSummary>(created);
    expect(state.synchronization).toBe('SYNCHRONIZED');
    expect(state.externalDraftExists).toBe(true);
    expect(state.currentRevisionNumber).toBe(ready.version);
    expect(state.publicPublishEnabled).toBe(false);
    expect(state.deleteEnabled).toBe(false);
    await request(server)
      .post(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: ready.version, idempotencyKey: key })
      .expect(201);
    await request(server)
      .post(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: ready.version, idempotencyKey: 'phase3b-repeat-new-key' })
      .expect(201);
    const binding = await database.contentPublication.findFirstOrThrow({
      where: { contentItemId: ready.id },
    });
    expect(await database.contentPublication.count({ where: { contentItemId: ready.id } })).toBe(1);
    expect(
      await database.providerPublication.count({
        where: { contentPublicationId: binding.id, operationType: 'CREATE_DRAFT' },
      }),
    ).toBe(1);
    const external = await database.externalPost.findFirstOrThrow({
      where: { connectionId, externalPostId: binding.externalPostId! },
    });
    expect(external.title).toBe(ready.title);
    expect(external.externalPostId).toBeTypeOf('string');
    expect(external.labels).toEqual(['blogger', 'phase 3b']);
    const persisted = await database.contentItem.findUniqueOrThrow({ where: { id: ready.id } });
    expect(persisted.editorialStatus).toBe('READY_TO_PUBLISH');
    expect(persisted.publicationStatus).toBe('DRAFT_SENT');
    const legacyTestPublication = await request(server)
      .get(
        `/api/v1/workspaces/${workspaceA}/websites/${websiteA}/integrations/blogger/test-publication/current`,
      )
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(legacyTestPublication.body).toBeNull();
    const audits = await database.auditLog.findMany({ where: { targetId: binding.id } });
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(ready.htmlContent);
    expect(serialized).not.toMatch(/accessToken|refreshToken|clientSecret/i);
  });

  it('prevents concurrent duplicate drafts and never trusts an externalPostId payload', async () => {
    const owner = await token('owner');
    const reviewer = await token('reviewer');
    const ready = await readyContent(owner, reviewer, 'handoff-concurrent');
    const calls = ['phase3b-race-one', 'phase3b-race-two'].map((idempotencyKey) =>
      request(server)
        .post(`${base()}/${ready.id}/publication/blogger/draft`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ expectedRevision: ready.version, idempotencyKey }),
    );
    const results = await Promise.all(calls);
    expect(results.some((result) => result.status === 201)).toBe(true);
    expect(results.every((result) => result.status === 201 || result.status === 409)).toBe(true);
    const binding = await database.contentPublication.findFirstOrThrow({
      where: { contentItemId: ready.id },
    });
    expect(await database.contentPublication.count({ where: { contentItemId: ready.id } })).toBe(1);
    expect(
      await database.providerPublication.count({
        where: { contentPublicationId: binding.id, operationType: 'CREATE_DRAFT' },
      }),
    ).toBe(1);
    await request(server)
      .patch(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({
        expectedRevision: ready.version,
        idempotencyKey: 'phase3b-arbitrary-id',
        externalPostId: 'attacker-controlled',
      })
      .expect(400);
  });

  it('marks newer internal revisions out of sync and updates the same Blogger draft explicitly', async () => {
    const owner = await token('owner');
    const reviewer = await token('reviewer');
    const ready = await readyContent(owner, reviewer, 'handoff-update');
    await request(server)
      .post(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: ready.version, idempotencyKey: 'phase3b-update-create' })
      .expect(201);
    const before = await database.contentPublication.findFirstOrThrow({
      where: { contentItemId: ready.id },
    });
    const editedResponse = await request(server)
      .patch(`${base()}/${ready.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({
        expectedVersion: ready.version,
        title: 'Titre interne révisé',
        htmlContent: '<h1>Titre interne révisé</h1><p>Corps synchronisé.</p>',
        labels: ['Révision'],
      })
      .expect(200);
    const edited = body<ContentItemSummary>(editedResponse);
    const state = await request(server)
      .get(`${base()}/${ready.id}/publication`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(body<ContentPublicationSummary>(state)).toMatchObject({
      synchronization: 'OUT_OF_SYNC',
    });
    const mismatched = await request(server)
      .patch(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: edited.version, idempotencyKey: 'phase3b-update-create' })
      .expect(409);
    expect(body<ApiErrorResponse>(mismatched).error.code).toBe('BLOGGER_DUPLICATE_OPERATION');
    await request(server)
      .patch(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: edited.version, idempotencyKey: 'phase3b-update-same' })
      .expect(200);
    const after = await database.contentPublication.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.externalPostId).toBe(before.externalPostId);
    expect(after.lastSynchronizedRevisionNumber).toBe(edited.version);
    expect(await database.contentPublication.count({ where: { contentItemId: ready.id } })).toBe(1);
    expect(
      (
        await database.externalPost.findFirstOrThrow({
          where: { connectionId, externalPostId: before.externalPostId! },
        })
      ).title,
    ).toBe('Titre interne révisé');
  });

  it('marks a provider-confirmed missing mock draft without automatic recreation', async () => {
    const owner = await token('owner');
    const reviewer = await token('reviewer');
    const ready = await readyContent(owner, reviewer, 'handoff-missing');
    await request(server)
      .post(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: ready.version, idempotencyKey: 'phase3b-missing-create' })
      .expect(201);
    const binding = await database.contentPublication.findFirstOrThrow({
      where: { contentItemId: ready.id },
    });
    const connection = await database.websiteConnection.findFirstOrThrow({
      where: { id: binding.connectionId, workspaceId: workspaceA, websiteId: websiteA },
    });
    await providers.active().deletePost(
      {
        connectionId: connection.id,
        mode: 'MOCK',
        workspaceId: connection.workspaceId,
        websiteId: connection.websiteId,
        externalSiteId: binding.externalSiteId,
      },
      {
        externalSiteId: binding.externalSiteId,
        externalPostId: binding.externalPostId!,
        idempotencyKey: 'phase3b-mock-delete-confirmation',
      },
    );
    const missing = await request(server)
      .get(`${base()}/${ready.id}/publication`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(body<ContentPublicationSummary>(missing).synchronization).toBe('MISSING');
    expect(
      (await database.contentPublication.findUniqueOrThrow({ where: { id: binding.id } })).status,
    ).toBe('MISSING');
    expect(await database.contentPublication.count({ where: { contentItemId: ready.id } })).toBe(1);
  });

  it('preserves binding across reconnect, rejects wrong sites, and never reconciles auth errors as missing', async () => {
    const owner = await token('owner');
    const reviewer = await token('reviewer');
    const ready = await readyContent(owner, reviewer, 'handoff-recovery');
    await request(server)
      .post(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: ready.version, idempotencyKey: 'phase3b-recovery-create' })
      .expect(201);
    const binding = await database.contentPublication.findFirstOrThrow({
      where: { contentItemId: ready.id },
    });
    const oldConnection = await database.websiteConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    await database.websiteConnection.update({
      where: { id: connectionId },
      data: { status: WebsiteConnectionStatus.DISCONNECTED, revokedAt: new Date() },
    });
    const replacement = await database.websiteConnection.create({
      data: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        provider: 'BLOGGER',
        mode: IntegrationMode.MOCK,
        status: WebsiteConnectionStatus.CONNECTED,
        externalAccountId: 'mock-google-account-reconnected',
        externalSiteId: oldConnection.externalSiteId,
        externalSiteName: oldConnection.externalSiteName,
        connectedByUserId: ownerId,
        connectedAt: new Date(),
      },
    });
    const recovered = await request(server)
      .get(`${base()}/${ready.id}/publication`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(body<ContentPublicationSummary>(recovered).associationId).toBe(binding.id);
    expect(
      (await database.contentPublication.findUniqueOrThrow({ where: { id: binding.id } }))
        .connectionId,
    ).toBe(replacement.id);

    const provider = providers.active();
    const spy = vi
      .spyOn(provider, 'getPost')
      .mockRejectedValueOnce(new ProviderError('BLOGGER_ACCOUNT_UNAUTHORIZED', 'expired'));
    const unauthorized = await request(server)
      .get(`${base()}/${ready.id}/publication`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(body<ContentPublicationSummary>(unauthorized).synchronization).toBe('ERROR');
    expect(
      (await database.contentPublication.findUniqueOrThrow({ where: { id: binding.id } })).status,
    ).toBe('ERROR');
    spy.mockRestore();

    await database.websiteConnection.update({
      where: { id: replacement.id },
      data: { status: WebsiteConnectionStatus.CONNECTED, lastErrorCode: null, lastErrorAt: null },
    });
    const reauthorized = await request(server)
      .get(`${base()}/${ready.id}/publication`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(body<ContentPublicationSummary>(reauthorized).synchronization).toBe('SYNCHRONIZED');
    expect(
      (await database.contentPublication.findUniqueOrThrow({ where: { id: binding.id } })).status,
    ).toBe('ACTIVE');

    await database.websiteConnection.update({
      where: { id: replacement.id },
      data: {
        status: WebsiteConnectionStatus.CONNECTED,
        externalSiteId: 'mock-blog-tourism-001',
      },
    });
    await request(server)
      .patch(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ expectedRevision: ready.version, idempotencyKey: 'phase3b-wrong-site' })
      .expect(409);
    await database.websiteConnection.update({
      where: { id: replacement.id },
      data: { externalSiteId: 'mock-blog-sports-001' },
    });
  });

  it('rejects foreign publication access and Phase 3B mutation rights for Viewer and SEO Manager', async () => {
    const owner = await token('owner');
    const reviewer = await token('reviewer');
    const viewer = await token('viewer');
    const seo = await token('seo');
    const outsider = await token('outsider');
    const ready = await readyContent(owner, reviewer, 'handoff-security');
    await request(server)
      .post(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${viewer}`)
      .send({ expectedRevision: ready.version, idempotencyKey: 'phase3b-viewer-denied' })
      .expect(403);
    await request(server)
      .post(`${base()}/${ready.id}/publication/blogger/draft`)
      .set('Authorization', `Bearer ${seo}`)
      .send({ expectedRevision: ready.version, idempotencyKey: 'phase3b-seo-denied' })
      .expect(403);
    await request(server)
      .get(`${base(workspaceA, websiteOther)}/${ready.id}/publication`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(404);
    await request(server)
      .get(`${base(workspaceA, websiteA)}/${ready.id}/publication`)
      .set('Authorization', `Bearer ${outsider}`)
      .expect(404);
    await request(server)
      .get(`${base(workspaceB, websiteB)}/${ready.id}/publication`)
      .set('Authorization', `Bearer ${outsider}`)
      .expect(404);
  });
});
