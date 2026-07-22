import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { durationToMilliseconds, type EnvironmentConfig } from '@ai-content-os/config';
import type { AuthUser, LoginResponse, SessionSummary } from '@ai-content-os/contracts';
import { DatabaseService, UserStatus } from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { PasswordService } from './password.service';
import { presentAuthUser } from './user.presenter';

export interface AuthResult extends LoginResponse {
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService<EnvironmentConfig, true>,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {
    this.dummyHash = this.passwords.hash('NonCredential-Dummy-Value-94721');
  }

  async login(
    emailInput: string,
    password: string,
    request: AuthenticatedRequest,
  ): Promise<AuthResult> {
    const email = emailInput.trim().toLowerCase();
    await this.consumeRateLimit('login', `${request.ip}:${this.stableHash(email)}`);
    const user = await this.database.user.findUnique({ where: { email } });
    const passwordHash = user?.passwordHash ?? (await this.dummyHash);
    const passwordValid = await this.passwords.verify(passwordHash, password);
    if (!user || !passwordValid || user.status !== UserStatus.ACTIVE) {
      await this.audit.record(
        {
          action: 'auth.login.failed',
          targetType: 'User',
          metadata: { emailFingerprint: this.stableHash(email), reason: 'invalid_credentials' },
        },
        request,
      );
      throw new CodedHttpException(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.authInvalidCredentials,
        'Identifiants invalides.',
      );
    }
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const refreshToken = this.createRefreshToken(sessionId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.refreshLifetime());
    await this.database.$transaction([
      this.database.user.update({ where: { id: user.id }, data: { lastLoginAt: now } }),
      this.database.session.create({
        data: {
          id: sessionId,
          userId: user.id,
          familyId,
          tokenHash: this.refreshVerifier(refreshToken),
          userAgent: request.header('user-agent')?.slice(0, 512) ?? null,
          ipAddress: request.ip?.slice(0, 64) ?? null,
          expiresAt,
          lastUsedAt: now,
        },
      }),
    ]);
    await this.audit.record(
      {
        action: 'auth.login.succeeded',
        actorUserId: user.id,
        targetType: 'Session',
        targetId: sessionId,
      },
      request,
    );
    return this.authResult(user.id, sessionId, refreshToken);
  }

  async refresh(
    refreshToken: string | undefined,
    request: AuthenticatedRequest,
  ): Promise<AuthResult> {
    await this.consumeRateLimit('refresh', request.ip ?? 'unknown');
    const sessionId = this.sessionIdFromRefreshToken(refreshToken);
    const session = sessionId
      ? await this.database.session.findUnique({
          where: { id: sessionId },
          include: { user: true },
        })
      : null;
    if (!refreshToken || !session) this.sessionError(ERROR_CODES.authSessionRevoked);
    const matches = this.verifiersMatch(session.tokenHash, this.refreshVerifier(refreshToken));
    if (!matches || session.revokedAt) {
      await this.revokeFamily(session.familyId, 'REFRESH_REUSE_DETECTED');
      await this.audit.record(
        {
          action: 'auth.refresh.reuse_detected',
          actorUserId: session.userId,
          targetType: 'Session',
          targetId: session.id,
        },
        request,
      );
      this.sessionError(ERROR_CODES.authSessionRevoked);
    }
    if (session.expiresAt <= new Date()) {
      await this.revokeFamily(session.familyId, 'EXPIRED');
      this.sessionError(ERROR_CODES.authSessionExpired);
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      await this.revokeFamily(session.familyId, 'USER_INACTIVE');
      throw new CodedHttpException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.userInactive,
        'Ce compte est inactif.',
      );
    }
    const rotatedToken = this.createRefreshToken(session.id);
    await this.database.session.update({
      where: { id: session.id },
      data: {
        tokenHash: this.refreshVerifier(rotatedToken),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + this.refreshLifetime()),
        userAgent: request.header('user-agent')?.slice(0, 512) ?? null,
        ipAddress: request.ip?.slice(0, 64) ?? null,
      },
    });
    return this.authResult(session.userId, session.id, rotatedToken);
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.authUser(userId);
    return presentAuthUser(user);
  }

  async logout(auth: AuthContext, request: AuthenticatedRequest): Promise<void> {
    await this.database.session.updateMany({
      where: { id: auth.sessionId, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: 'LOGOUT' },
    });
    await this.audit.record(
      {
        action: 'auth.logout',
        actorUserId: auth.userId,
        targetType: 'Session',
        targetId: auth.sessionId,
      },
      request,
    );
  }

  async logoutAll(auth: AuthContext, request: AuthenticatedRequest): Promise<void> {
    await this.revokeUserSessions(auth.userId, 'LOGOUT_ALL');
    await this.audit.record(
      {
        action: 'auth.logout_all',
        actorUserId: auth.userId,
        targetType: 'User',
        targetId: auth.userId,
      },
      request,
    );
  }

  async sessions(auth: AuthContext): Promise<SessionSummary[]> {
    const sessions = await this.database.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((session) => ({
      id: session.id,
      current: session.id === auth.sessionId,
      ...(session.userAgent ? { userAgent: session.userAgent } : {}),
      ...(session.ipAddress ? { ipAddress: session.ipAddress } : {}),
      expiresAt: session.expiresAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
    }));
  }

  async revokeSession(
    auth: AuthContext,
    sessionId: string,
    request: AuthenticatedRequest,
  ): Promise<boolean> {
    const result = await this.database.session.updateMany({
      where: { id: sessionId, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: 'USER_REVOKED' },
    });
    if (!result.count) {
      throw new CodedHttpException(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.notFound,
        'Session introuvable.',
      );
    }
    await this.audit.record(
      {
        action: 'auth.session.revoked',
        actorUserId: auth.userId,
        targetType: 'Session',
        targetId: sessionId,
      },
      request,
    );
    return sessionId === auth.sessionId;
  }

  async changePassword(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    const user = await this.database.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new CodedHttpException(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.authInvalidCredentials,
        'Mot de passe actuel invalide.',
      );
    }
    this.passwords.assertValid(newPassword);
    if (await this.passwords.verify(user.passwordHash, newPassword)) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Le nouveau mot de passe doit être différent du mot de passe actuel.',
      );
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.database.$transaction([
      this.database.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      }),
      this.database.session.updateMany({
        where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'PASSWORD_CHANGED' },
      }),
    ]);
    await this.audit.record(
      {
        action: 'auth.password.changed',
        actorUserId: user.id,
        targetType: 'User',
        targetId: user.id,
      },
      request,
    );
  }

  revokeUserSessions(userId: string, reason: string): Promise<{ count: number }> {
    return this.database.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: reason },
    });
  }

  private async authResult(
    userId: string,
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthResult> {
    const user = await this.authUser(userId);
    const expiresIn = Math.floor(
      durationToMilliseconds(this.config.get('JWT_ACCESS_TTL', { infer: true })) / 1_000,
    );
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, sessionId, email: user.email, version: user.securityVersion },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn,
      },
    );
    return { accessToken, expiresIn, user: presentAuthUser(user), refreshToken };
  }

  private authUser(userId: string) {
    return this.database.user.findUniqueOrThrow({
      where: { id: userId },
      include: { workspaceMembers: { include: { workspace: true } } },
    });
  }

  private createRefreshToken(sessionId: string): string {
    return `${sessionId}.${randomBytes(48).toString('base64url')}`;
  }

  private sessionIdFromRefreshToken(token: string | undefined): string | undefined {
    const sessionId = token?.split('.', 1)[0];
    return sessionId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
      ? sessionId
      : undefined;
  }

  private refreshVerifier(token: string): string {
    return createHmac('sha256', this.config.get('REFRESH_TOKEN_SECRET', { infer: true }))
      .update(token)
      .digest('hex');
  }

  private verifiersMatch(stored: string, candidate: string): boolean {
    const left = Buffer.from(stored, 'hex');
    const right = Buffer.from(candidate, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private refreshLifetime(): number {
    return durationToMilliseconds(this.config.get('REFRESH_TOKEN_TTL', { infer: true }));
  }

  private stableHash(value: string): string {
    return createHmac('sha256', this.config.get('REFRESH_TOKEN_SECRET', { infer: true }))
      .update(value)
      .digest('hex')
      .slice(0, 24);
  }

  private async consumeRateLimit(scope: string, identity: string): Promise<void> {
    const key = `auth-rate:${scope}:${identity}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.pexpire(
        key,
        durationToMilliseconds(this.config.get('LOGIN_RATE_LIMIT_WINDOW', { infer: true })),
      );
    }
    if (count > this.config.get('LOGIN_RATE_LIMIT_MAX', { infer: true })) {
      throw new CodedHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        ERROR_CODES.rateLimitExceeded,
        'Trop de tentatives. Réessayez plus tard.',
      );
    }
  }

  private revokeFamily(familyId: string, reason: string): Promise<{ count: number }> {
    return this.database.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: reason },
    });
  }

  private sessionError(code: string): never {
    throw new CodedHttpException(
      HttpStatus.UNAUTHORIZED,
      code,
      code === ERROR_CODES.authSessionExpired
        ? 'La session a expiré.'
        : 'La session n’est plus valide.',
    );
  }
}
