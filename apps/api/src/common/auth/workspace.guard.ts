import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService, UserStatus } from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type { AuthenticatedRequest } from './auth.types';
import { permissionsForRole } from './permissions';
import { CodedHttpException } from '../errors/coded-http.exception';

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawWorkspaceId = request.params['workspaceId'];
    const workspaceId = Array.isArray(rawWorkspaceId) ? rawWorkspaceId[0] : rawWorkspaceId;
    if (!request.auth || !workspaceId) return false;
    const member = await this.database.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: request.auth.userId, workspaceId } },
      include: { workspace: true, user: true },
    });
    if (!member || !member.workspace.isActive || member.user.status !== UserStatus.ACTIVE) {
      throw new CodedHttpException(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.workspaceNotFound,
        'Espace introuvable.',
      );
    }
    request.workspace = {
      id: member.workspaceId,
      memberId: member.id,
      role: member.role,
      permissions: permissionsForRole(member.role),
    };
    return true;
  }
}
