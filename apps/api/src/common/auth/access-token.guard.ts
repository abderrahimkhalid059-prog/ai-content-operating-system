import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { EnvironmentConfig } from '@ai-content-os/config';
import { DatabaseService, UserStatus } from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type { AuthenticatedRequest } from './auth.types';
import { ALLOW_PASSWORD_CHANGE_KEY, IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { CodedHttpException } from '../errors/coded-http.exception';

interface AccessClaims {
  sub: string;
  sessionId: string;
  email: string;
  version: number;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentConfig, true>,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) this.unauthorized();
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(authorization.slice(7), {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      this.unauthorized();
    }
    const session = await this.database.session.findUnique({
      where: { id: claims.sessionId },
      include: { user: true },
    });
    const now = new Date();
    if (!session || session.userId !== claims.sub || session.revokedAt) {
      throw new CodedHttpException(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.authSessionRevoked,
        'La session n’est plus valide.',
      );
    }
    if (session.expiresAt <= now) {
      throw new CodedHttpException(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.authSessionExpired,
        'La session a expiré.',
      );
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      throw new CodedHttpException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.userInactive,
        'Ce compte est inactif.',
      );
    }
    if (claims.version !== session.user.securityVersion) this.unauthorized();
    request.auth = {
      userId: session.user.id,
      email: session.user.email,
      sessionId: session.id,
      securityVersion: session.user.securityVersion,
      mustChangePassword: session.user.mustChangePassword,
    };
    const passwordChangeAllowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PASSWORD_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (session.user.mustChangePassword && !passwordChangeAllowed) {
      throw new CodedHttpException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.authPasswordChangeRequired,
        'Vous devez modifier votre mot de passe.',
      );
    }
    return true;
  }

  private unauthorized(): never {
    throw new CodedHttpException(
      HttpStatus.UNAUTHORIZED,
      ERROR_CODES.unauthorized,
      'Authentification requise.',
    );
  }
}
