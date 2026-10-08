import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AiGenerationApplyResult,
  AiGenerationCandidateSummary,
  ContentItemSummary,
} from '@ai-content-os/contracts';
import {
  AiConfigurationScope,
  AiGenerationCandidateStatus,
  ContentEditorialStatus,
  ContentPublicationStatus,
  ContentRevisionOrigin,
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
  throw new Error('Phase 4B integration database and Redis are required.');
}

describe('Phase 4B controlled article generation API integration', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let redis: Redis;
  let workspaceA: string;
  let workspaceB: string;
  let websiteA: string;
  let websiteAOther: string;
  let websiteB: string;
  let profileA: string;
  let profileAOther: string;
  let sequence = 0;
  const password = 'Phase-4B-Password-9472';

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

    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase4b-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase4b.test' } } });
    const passwordHash = await hash(password, { type: argon2id });
    const users = await Promise.all(
      ['owner', 'writer', 'outsider'].map((name) =>
        database.user.create({
          data: {
            email: `${name}@phase4b.test`,
            displayName: name,
            passwordHash,
            mustChangePassword: false,
          },
        }),
      ),
    );
    const [owner, writer, outsider] = users;
    if (!owner || !writer || !outsider) throw new Error('Missing Phase 4B users.');
    const [firstWorkspace, secondWorkspace] = await Promise.all([
      database.workspace.create({ data: { name: 'Phase 4B A', slug: 'phase4b-a' } }),
      database.workspace.create({ data: { name: 'Phase 4B B', slug: 'phase4b-b' } }),
    ]);
    workspaceA = firstWorkspace.id;
    workspaceB = secondWorkspace.id;
    await database.workspaceMember.createMany({
      data: [
        { workspaceId: workspaceA, userId: owner.id, role: WorkspaceRole.OWNER },
        { workspaceId: workspaceA, userId: writer.id, role: WorkspaceRole.WRITER },
        { workspaceId: workspaceB, userId: outsider.id, role: WorkspaceRole.OWNER },
      ],
    });
    const [firstSite, secondSite] = await Promise.all([
      database.website.create({
        data: {
          workspaceId: workspaceA,
          name: 'Site Phase 4B A',
          slug: 'phase4b-site-a',
          platform: WebsitePlatform.OTHER,
          language: 'fr',
          locale: 'fr-FR',
          timezone: 'Europe/Paris',
          status: WebsiteStatus.ACTIVE,
        },
      }),
      database.website.create({
        data: {
          workspaceId: workspaceB,
          name: 'Site Phase 4B B',
          slug: 'phase4b-site-b',
          platform: WebsitePlatform.OTHER,
          language: 'es',
          timezone: 'UTC',
          status: WebsiteStatus.ACTIVE,
        },
      }),
    ]);
    websiteA = firstSite.id;
    websiteB = secondSite.id;
    const otherSite = await database.website.create({
      data: {
        workspaceId: workspaceA,
        name: 'Autre site Phase 4B A',
        slug: 'phase4b-site-a-other',
        platform: WebsitePlatform.OTHER,
        language: 'de',
        timezone: 'UTC',
        status: WebsiteStatus.ACTIVE,
      },
    });
    websiteAOther = otherSite.id;
    const profile = await database.contentProfile.create({
      data: {
        workspaceId: workspaceA,
        websiteId: websiteA,
        name: 'Profil Phase 4B',
        language: 'fr',
        locale: 'fr-FR',
        tone: 'Clair et factuel',
        targetAudience: 'Lecteurs généraux',
        editorialRules: { facts: 'must-be-reviewed' },
        prohibitedTopics: ['données sensibles'],
        isDefault: true,
      },
    });
    profileA = profile.id;
    profileAOther = (
      await database.contentProfile.create({
        data: {
          workspaceId: workspaceA,
          websiteId: websiteAOther,
          name: 'Profil autre site Phase 4B',
          language: 'de',
          tone: 'Sachlich',
          editorialRules: {},
        },
      })
    ).id;
  }, 60_000);

  beforeEach(async () => {
    const keys = await redis.keys('auth-rate:*');
    if (keys.length) await redis.del(...keys);
    await database.aiConfiguration.upsert({
      where: {
        workspaceId_scope_scopeKey: {
          workspaceId: workspaceA,
          scope: AiConfigurationScope.WORKSPACE,
          scopeKey: workspaceA,
        },
      },
      create: {
        workspaceId: workspaceA,
        scope: AiConfigurationScope.WORKSPACE,
        scopeKey: workspaceA,
        providerKey: 'mock',
        model: 'mock-v1',
        timeoutMs: 100,
        maxRetries: 0,
      },
      update: {
        providerKey: 'mock',
        model: 'mock-v1',
        timeoutMs: 100,
        maxRetries: 0,
        monthlyTokenLimit: null,
        isEnabled: true,
      },
    });
  });

  afterAll(async () => {
    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase4b-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase4b.test' } } });
    await redis.quit();
    await app.close();
  });

  async function token(name: 'owner' | 'writer' | 'outsider'): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${name}@phase4b.test`, password })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function createContent(accessToken: string): Promise<ContentItemSummary> {
    sequence += 1;
    const response = await request(server)
      .post(`/api/v1/workspaces/${workspaceA}/websites/${websiteA}/contents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: `Article Phase 4B ${sequence}`,
        slug: `article-phase4b-${sequence}`,
        htmlContent: '<p>Contenu humain initial.</p>',
        language: 'fr',
        locale: 'fr-FR',
        labels: ['initial'],
        editorialStatus: 'DRAFT',
        contentProfileId: profileA,
      })
      .expect(201);
    return response.body as ContentItemSummary;
  }

  function generationPath(contentId: string, workspace = workspaceA, website = websiteA): string {
    return `/api/v1/workspaces/${workspace}/websites/${website}/contents/${contentId}/ai-generations`;
  }

  function brief(content: ContentItemSummary, idempotencyKey = randomUUID()) {
    return {
      expectedVersion: content.version,
      contentProfileId: profileA,
      topic: 'Un sujet générique sans recherche externe',
      angle: 'Présentation contrôlée',
      targetAudience: 'Lecteurs humains',
      instructions: 'Ne pas inventer de faits.',
      approximateLength: 500,
      idempotencyKey,
    };
  }

  it('creates a durable preview idempotently without changing the content revision', async () => {
    const accessToken = await token('owner');
    const content = await createContent(accessToken);
    const revisionsBefore = await database.contentRevision.count({
      where: { contentItemId: content.id },
    });
    const key = randomUUID();
    const first = await request(server)
      .post(generationPath(content.id))
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-request-id', 'phase4b-preview-safe')
      .send(brief(content, key))
      .expect(201);
    const replay = await request(server)
      .post(generationPath(content.id))
      .set('Authorization', `Bearer ${accessToken}`)
      .send(brief(content, key))
      .expect(201);
    const preview = first.body as AiGenerationCandidateSummary;
    expect(preview).toMatchObject({
      status: 'READY',
      baseRevisionNumber: content.version,
      providerKey: 'mock',
      model: 'mock-v1',
      promptIdentifier: 'article.draft',
      promptVersion: 1,
    });
    expect(preview.draft?.title).toBe('Brouillon éditorial déterministe');
    expect((replay.body as AiGenerationCandidateSummary).id).toBe(preview.id);
    expect(await database.contentRevision.count({ where: { contentItemId: content.id } })).toBe(
      revisionsBefore,
    );
    expect(
      await database.contentItem.findUniqueOrThrow({ where: { id: content.id } }),
    ).toMatchObject({ title: content.title, version: content.version });
    if (!preview.aiRunId) throw new Error('A completed preview must expose its AI run ID.');
    const run = await database.aiRun.findUniqueOrThrow({ where: { id: preview.aiRunId } });
    expect(run).toMatchObject({
      operation: 'ARTICLE_DRAFT_GENERATION',
      status: 'COMPLETED',
      totalTokens: 19,
      correlationId: 'phase4b-preview-safe',
    });
    const audits = await database.auditLog.findMany({
      where: { workspaceId: workspaceA, targetId: content.id },
    });
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'content.ai_generation_requested',
        'content.ai_generation_completed',
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain('Ne pas inventer de faits.');
    const discarded = await request(server)
      .post(`${generationPath(content.id)}/${preview.id}/discard`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(discarded.body).toMatchObject({ status: 'DISCARDED' });
    expect(
      await database.auditLog.count({
        where: { action: 'content.ai_generation_discarded', targetId: content.id },
      }),
    ).toBe(1);
  });

  it('applies explicitly exactly once as a normal draft revision with AI provenance', async () => {
    const accessToken = await token('owner');
    const content = await createContent(accessToken);
    const generated = await request(server)
      .post(generationPath(content.id))
      .set('Authorization', `Bearer ${accessToken}`)
      .send(brief(content))
      .expect(201);
    const candidate = generated.body as AiGenerationCandidateSummary;
    const endpoint = `${generationPath(content.id)}/${candidate.id}/apply`;
    const [first, replay] = await Promise.all([
      request(server).post(endpoint).set('Authorization', `Bearer ${accessToken}`).expect(201),
      request(server).post(endpoint).set('Authorization', `Bearer ${accessToken}`).expect(201),
    ]);
    const result = first.body as AiGenerationApplyResult;
    expect(replay.body as AiGenerationApplyResult).toEqual(result);
    expect(result).toMatchObject({ status: 'APPLIED', revisionNumber: content.version + 1 });
    const revisions = await database.contentRevision.findMany({
      where: { contentItemId: content.id },
      orderBy: { revisionNumber: 'asc' },
    });
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toMatchObject({
      origin: ContentRevisionOrigin.AI_GENERATED,
      aiRunId: candidate.aiRunId,
      aiGenerationCandidateId: candidate.id,
      baseRevisionNumber: content.version,
      editorialStatus: ContentEditorialStatus.DRAFT,
      publicationStatus: ContentPublicationStatus.NOT_PUBLISHED,
    });
    const updated = await database.contentItem.findUniqueOrThrow({ where: { id: content.id } });
    expect(updated).toMatchObject({
      version: content.version + 1,
      editorialStatus: ContentEditorialStatus.DRAFT,
      publicationStatus: ContentPublicationStatus.NOT_PUBLISHED,
    });
    expect(
      await database.auditLog.count({
        where: { action: 'content.ai_generation_applied', targetId: content.id },
      }),
    ).toBe(1);
  });

  it('rejects a stale candidate without applying or consuming it', async () => {
    const accessToken = await token('owner');
    const content = await createContent(accessToken);
    const generated = await request(server)
      .post(generationPath(content.id))
      .set('Authorization', `Bearer ${accessToken}`)
      .send(brief(content))
      .expect(201);
    const candidate = generated.body as AiGenerationCandidateSummary;
    await database.contentItem.update({
      where: { id: content.id },
      data: { version: { increment: 1 } },
    });
    const response = await request(server)
      .post(`${generationPath(content.id)}/${candidate.id}/apply`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);
    expect(response.body).toMatchObject({ error: { code: 'AI_GENERATION_STALE' } });
    expect(
      await database.aiGenerationCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    ).toMatchObject({ status: AiGenerationCandidateStatus.READY });
    expect(await database.contentRevision.count({ where: { contentItemId: content.id } })).toBe(1);
  });

  it('enforces DTO strictness, RBAC, workspace isolation, and website scoping', async () => {
    const ownerToken = await token('owner');
    const writerToken = await token('writer');
    const outsiderToken = await token('outsider');
    const content = await createContent(ownerToken);
    await request(server)
      .post(generationPath(content.id))
      .set('Authorization', `Bearer ${writerToken}`)
      .send(brief(content))
      .expect(403);
    await request(server)
      .post(generationPath(content.id, workspaceB, websiteB))
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send(brief(content))
      .expect(404);
    await request(server)
      .post(generationPath(content.id, workspaceA, websiteB))
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(brief(content))
      .expect(404);
    await request(server)
      .post(generationPath(content.id))
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...brief(content), contentProfileId: profileAOther })
      .expect(400);
    await request(server)
      .post(generationPath(content.id))
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...brief(content), arbitrary: 'rejected' })
      .expect(400);
  });

  it.each([
    ['mock-malformed-structured', 502, 'AI_MALFORMED_RESPONSE'],
    ['mock-provider-error', 502, 'AI_PROVIDER_ERROR'],
    ['mock-timeout', 504, 'AI_TIMEOUT'],
  ] as const)(
    'persists a safe failed attempt for %s without a content mutation',
    async (model, status, code) => {
      const accessToken = await token('owner');
      const content = await createContent(accessToken);
      await database.aiConfiguration.update({
        where: {
          workspaceId_scope_scopeKey: {
            workspaceId: workspaceA,
            scope: AiConfigurationScope.WORKSPACE,
            scopeKey: workspaceA,
          },
        },
        data: { model, timeoutMs: 100, maxRetries: 0 },
      });
      const response = await request(server)
        .post(generationPath(content.id))
        .set('Authorization', `Bearer ${accessToken}`)
        .send(brief(content))
        .expect(status);
      expect(response.body).toMatchObject({ error: { code } });
      const candidate = await database.aiGenerationCandidate.findFirstOrThrow({
        where: { contentItemId: content.id },
        include: { aiRun: true },
      });
      expect(candidate).toMatchObject({
        status: AiGenerationCandidateStatus.FAILED,
        errorCode: code,
      });
      expect(candidate.aiRun).toMatchObject({ status: 'FAILED', errorCode: code });
      expect(await database.contentRevision.count({ where: { contentItemId: content.id } })).toBe(
        1,
      );
    },
  );

  it('enforces the configured monthly limit before invoking the provider', async () => {
    const accessToken = await token('owner');
    const content = await createContent(accessToken);
    await database.aiConfiguration.update({
      where: {
        workspaceId_scope_scopeKey: {
          workspaceId: workspaceA,
          scope: AiConfigurationScope.WORKSPACE,
          scopeKey: workspaceA,
        },
      },
      data: { monthlyTokenLimit: 0 },
    });
    const response = await request(server)
      .post(generationPath(content.id))
      .set('Authorization', `Bearer ${accessToken}`)
      .send(brief(content))
      .expect(429);
    expect(response.body).toMatchObject({ error: { code: 'AI_MONTHLY_LIMIT_REACHED' } });
    const candidate = await database.aiGenerationCandidate.findFirstOrThrow({
      where: { contentItemId: content.id },
    });
    expect(candidate).toMatchObject({
      status: AiGenerationCandidateStatus.FAILED,
      aiRunId: null,
    });
    expect(
      await database.aiRun.count({
        where: { idempotencyKey: `article-generation:${candidate.id}` },
      }),
    ).toBe(0);
  });
});
