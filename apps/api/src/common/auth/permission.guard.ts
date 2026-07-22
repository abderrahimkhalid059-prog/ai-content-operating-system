import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@ai-content-os/contracts';
import { ERROR_CODES } from '@ai-content-os/shared';
import type { AuthenticatedRequest } from './auth.types';
import { PERMISSIONS_KEY } from '../decorators/auth.decorators';
import { CodedHttpException } from '../errors/coded-http.exception';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (
      !request.workspace ||
      !required.every((item) => request.workspace?.permissions.includes(item))
    ) {
      throw new CodedHttpException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.workspaceAccessDenied,
        'Vous ne disposez pas de cette autorisation.',
      );
    }
    return true;
  }
}
