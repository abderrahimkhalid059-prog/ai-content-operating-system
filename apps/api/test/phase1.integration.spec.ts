import type { Server } from 'node:http';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ContentProfileStatus,
  DatabaseService,
  UserStatus,
  WebsitePlatform,
  WebsiteStatus,
  WorkspaceRole,
} from '@ai-content-os/database';
import { hash, argon2id } from 'argon2';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { AppModule } from '../src/app.module';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error(
    'TEST_DATABASE_URL and TEST_REDIS_URL are required for Phase 1 integration tests.',
  );
}

describe('Phase 1 API integration', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let redis: Redis;
  let ownerId: string;
  let ownerMemberId: string;
  let workspaceA: string;
  let workspaceB: string;
  let websiteB: string;
  let profileB: string;
  const ownerPassword = 'Owner-Integration-9472';

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

    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase1-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase1.test' } } });
    const passwordHash = await hash(ownerPassword, { type: argon2id });
    const owner = await database.user.create({
      data: {
        email: 'owner@phase1.test',
        displayName: 'Owner Phase 1',
        passwordHash,
        mustChangePassword: false,
      },
    });
    ownerId = owner.id;
    const first = await database.workspace.create({
      data: { name: 'Phase 1 A', slug: 'phase1-a' },
    });
    const second = await database.workspace.create({
      data: { name: 'Phase 1 B', slug: 'phase1-b' },
    });
    workspaceA = first.id;
    workspaceB = second.id;
    const ownerMembership = await database.workspaceMember.create({
      data: { userId: owner.id, workspaceId: first.id, role: WorkspaceRole.OWNER },
    });
    ownerMemberId = ownerMembership.id;
    const viewer = await database.user.create({
      data: { email: 'viewer@phase1.test', passwordHash, mustChangePassword: false },
    });
    await database.workspaceMember.create({
      data: { userId: viewer.id, workspaceId: second.id, role: WorkspaceRole.VIEWER },
    });
    const admin = await database.user.create({
      data: { email: 'admin@phase1.test', passwordHash, mustChangePassword: false },
    });
    await database.workspaceMember.create({
      data: { userId: admin.id, workspaceId: first.id, role: WorkspaceRole.ADMIN },
    });
    const forced = await database.user.create({
      data: { email: 'forced@phase1.test', passwordHash, mustChangePassword: true },
    });
    await database.workspaceMember.create({
      data: { userId: forced.id, workspaceId: first.id, role: WorkspaceRole.VIEWER },
    });
    const site = await database.website.create({
      data: {
        workspaceId: second.id,
        name: 'Tenant B',
        slug: 'tenant-b',
        platform: WebsitePlatform.OTHER,
        language: 'fr',
        timezone: 'UTC',
        status: WebsiteStatus.ACTIVE,
      },
    });
    websiteB = site.id;
    const tenantBProfile = await database.contentProfile.create({
      data: {
        workspaceId: second.id,
        websiteId: site.id,
        name: 'Tenant B profile',
        language: 'fr',
        tone: 'Clair',
        editorialRules: { factual: true },
        isDefault: true,
      },
    });
    profileB = tenantBProfile.id;
    await database.user.create({
      data: { email: 'password@phase1.test', passwordHash, mustChangePassword: false },
    });
  }, 60_000);

  beforeEach(async () => {
    const keys = await redis.keys('auth-rate:*');
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await database.workspace.deleteMany({ where: { slug: { startsWith: 'phase1-' } } });
    await database.user.deleteMany({ where: { email: { endsWith: '@phase1.test' } } });
    await redis.quit();
    await app.close();
  });

  function login(email = 'owner@phase1.test', password = ownerPassword) {
    return request(server).post('/api/v1/auth/login').send({ email, password });
  }

  function firstCookie(response: request.Response): string {
    const cookies = response.headers['set-cookie'];
    const value = Array.isArray(cookies) ? cookies[0] : cookies;
    if (!value) throw new Error('Expected a Set-Cookie header.');
    return value;
  }

  function refreshCookiePair(response: request.Response): string {
    const value = firstCookie(response).split(';')[0];
    if (!value) throw new Error('Expected the refresh cookie pair.');
    return value;
  }

  it('logs in with generic errors and secure cookie attributes', async () => {
    const failed = await login('missing@phase1.test', 'Wrong-Password-1234').expect(401);
    expect(failed.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    const response = await login().expect(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(firstCookie(response)).toContain('HttpOnly');
    expect(firstCookie(response)).toContain('Path=/api/v1/auth');
    expect(firstCookie(response)).toContain('SameSite=Lax');
  });

  it('rate limits repeated login abuse', async () => {
    await login('missing-rate@phase1.test', 'Wrong-Password-1234').expect(401);
    await login('missing-rate@phase1.test', 'Wrong-Password-1234').expect(401);
    const limited = await login('missing-rate@phase1.test', 'Wrong-Password-1234').expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('rotates refresh tokens and revokes a family when an old token is reused', async () => {
    const agent = request.agent(server);
    const loggedIn = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'owner@phase1.test', password: ownerPassword })
      .expect(200);
    const oldCookie = firstCookie(loggedIn).split(';')[0];
    if (!oldCookie) throw new Error('Expected the refresh cookie value.');
    const refreshed = await agent.post('/api/v1/auth/refresh').expect(200);
    expect(firstCookie(refreshed).split(';')[0]).not.toBe(oldCookie);
    const reused = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(401);
    expect(reused.body.error.code).toBe('AUTH_SESSION_REVOKED');
    const refreshValue = oldCookie.split('=')[1];
    const reusedSessionId = refreshValue?.split('.')[0];
    if (!reusedSessionId) throw new Error('Expected a session ID in the refresh cookie.');
    expect(
      (await database.session.findUniqueOrThrow({ where: { id: reusedSessionId } })).revokedAt,
    ).not.toBeNull();
  });

  it('lists and revokes active sessions', async () => {
    const response = await login().expect(200);
    const token = response.body.accessToken as string;
    const sessions = await request(server)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(sessions.body.length).toBeGreaterThan(0);
    await request(server)
      .delete(`/api/v1/auth/sessions/${sessions.body[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  it('logs out one session and logs out all sessions for the current user', async () => {
    const single = await login().expect(200);
    const singleToken = single.body.accessToken as string;
    const singleCookie = refreshCookiePair(single);
    await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${singleToken}`)
      .set('Cookie', singleCookie)
      .expect(204);
    await request(server).post('/api/v1/auth/refresh').set('Cookie', singleCookie).expect(401);

    const loginKeys = await redis.keys('auth-rate:login:*');
    if (loginKeys.length) await redis.del(...loginKeys);

    const first = await login().expect(200);
    const second = await login().expect(200);
    const secondCookie = refreshCookiePair(second);
    await request(server)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${first.body.accessToken as string}`)
      .expect(204);
    await request(server).post('/api/v1/auth/refresh').set('Cookie', secondCookie).expect(401);
    expect(await database.session.count({ where: { userId: ownerId, revokedAt: null } })).toBe(0);
  });

  it('allows forced-password users only through the password-change flow', async () => {
    const response = await login('forced@phase1.test').expect(200);
    const token = response.body.accessToken as string;
    expect(response.body.user.mustChangePassword).toBe(true);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const blocked = await request(server)
      .get('/api/v1/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(blocked.body.error.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
  });

  it('changes a password, rejects reuse, and rejects the old credential', async () => {
    const loggedIn = await login('password@phase1.test').expect(200);
    const token = loggedIn.body.accessToken as string;
    await request(server)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: ownerPassword, newPassword: ownerPassword })
      .expect(400);
    await request(server)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: ownerPassword, newPassword: 'Changed-Password-5821' })
      .expect(204);
    await login('password@phase1.test', ownerPassword).expect(401);
    const keys = await redis.keys('auth-rate:login:*');
    if (keys.length) await redis.del(...keys);
    await login('password@phase1.test', 'Changed-Password-5821').expect(200);
  });

  it('rejects inactive users without account enumeration', async () => {
    await database.user.update({ where: { id: ownerId }, data: { status: UserStatus.INACTIVE } });
    const response = await login().expect(401);
    expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    await database.user.update({ where: { id: ownerId }, data: { status: UserStatus.ACTIVE } });
  });

  it('enforces workspace isolation for membership and raw resource IDs', async () => {
    const token = (await login().expect(200)).body.accessToken as string;
    await request(server)
      .get(`/api/v1/workspaces/${workspaceB}/websites`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(server)
      .get(`/api/v1/workspaces/${workspaceA}/websites/${websiteB}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(server)
      .patch(`/api/v1/workspaces/${workspaceA}/websites/${websiteB}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cross-tenant mutation' })
      .expect(404);
    await request(server)
      .delete(`/api/v1/workspaces/${workspaceA}/websites/${websiteB}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(server)
      .get(`/api/v1/workspaces/${workspaceA}/websites/${websiteB}/content-profiles/${profileB}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(server)
      .get(`/api/v1/workspaces/${workspaceB}/members`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('prevents Viewer mutations', async () => {
    const token = (await login('viewer@phase1.test').expect(200)).body.accessToken as string;
    await request(server)
      .post(`/api/v1/workspaces/${workspaceB}/websites`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Forbidden',
        slug: 'forbidden',
        platform: 'OTHER',
        language: 'fr',
        timezone: 'UTC',
      })
      .expect(403);
  });

  it('protects the final active Owner and rejects duplicate memberships', async () => {
    const token = (await login().expect(200)).body.accessToken as string;
    const demotion = await request(server)
      .patch(`/api/v1/workspaces/${workspaceA}/members/${ownerMemberId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'VIEWER' })
      .expect(409);
    expect(demotion.body.error.code).toBe('WORKSPACE_LAST_OWNER');
    const duplicate = await request(server)
      .post(`/api/v1/workspaces/${workspaceA}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'owner@phase1.test', role: 'ADMIN' })
      .expect(409);
    expect(duplicate.body.error.code).toBe('MEMBER_ALREADY_EXISTS');
  });

  it('prevents an Admin from managing or promoting Owners', async () => {
    const token = (await login('admin@phase1.test').expect(200)).body.accessToken as string;
    const demotion = await request(server)
      .patch(`/api/v1/workspaces/${workspaceA}/members/${ownerMemberId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'VIEWER' })
      .expect(403);
    expect(demotion.body.error.code).toBe('MEMBER_ROLE_FORBIDDEN');
    const promotion = await request(server)
      .post(`/api/v1/workspaces/${workspaceA}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'viewer@phase1.test', role: 'OWNER' })
      .expect(403);
    expect(promotion.body.error.code).toBe('MEMBER_ROLE_FORBIDDEN');
  });

  it('validates timezone and allows the same slug in different workspaces', async () => {
    const token = (await login().expect(200)).body.accessToken as string;
    await request(server)
      .post(`/api/v1/workspaces/${workspaceA}/websites`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Bad timezone',
        slug: 'bad-timezone',
        platform: 'OTHER',
        language: 'fr',
        timezone: 'Mars/Olympus',
      })
      .expect(400);
    const created = await request(server)
      .post(`/api/v1/workspaces/${workspaceA}/websites`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Tenant A',
        slug: 'tenant-b',
        platform: 'OTHER',
        language: 'fr',
        timezone: 'UTC',
      })
      .expect(201);
    expect(created.body.slug).toBe('tenant-b');
  });

  it('keeps one active default content profile per website', async () => {
    const token = (await login().expect(200)).body.accessToken as string;
    const site = await database.website.findFirstOrThrow({ where: { workspaceId: workspaceA } });
    const base = `/api/v1/workspaces/${workspaceA}/websites/${site.id}/content-profiles`;
    const first = await request(server)
      .post(base)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'First',
        language: 'fr',
        tone: 'Professionnel',
        editorialRules: { attributionRequired: true },
        isDefault: true,
      })
      .expect(201);
    const second = await request(server)
      .post(base)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second', language: 'fr', tone: 'Clair', editorialRules: { factual: true } })
      .expect(201);
    await request(server)
      .post(`${base}/${second.body.id}/set-default`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const defaults = await database.contentProfile.count({
      where: { websiteId: site.id, status: ContentProfileStatus.ACTIVE, isDefault: true },
    });
    expect(defaults).toBe(1);
    expect(
      (await database.contentProfile.findUniqueOrThrow({ where: { id: first.body.id } })).isDefault,
    ).toBe(false);
    await request(server)
      .post(base)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Oversized',
        language: 'fr',
        tone: 'Clair',
        editorialRules: { content: 'x'.repeat(17_000) },
      })
      .expect(400);
  });

  it('creates users with one-time temporary passwords and performs administrative reset', async () => {
    const token = (await login().expect(200)).body.accessToken as string;
    const created = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'created@phase1.test', displayName: 'Created' })
      .expect(201);
    expect(created.body.temporaryPassword).toEqual(expect.any(String));
    expect(created.body.user).not.toHaveProperty('passwordHash');
    const reset = await request(server)
      .post(`/api/v1/users/${created.body.user.id}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(reset.body.temporaryPassword).not.toBe(created.body.temporaryPassword);
    expect(
      (await database.user.findUniqueOrThrow({ where: { id: created.body.user.id } }))
        .mustChangePassword,
    ).toBe(true);
  });
});
