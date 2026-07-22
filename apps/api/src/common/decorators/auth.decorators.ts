import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@ai-content-os/contracts';
import type { AuthContext, AuthenticatedRequest, WorkspaceContext } from '../auth/auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const ALLOW_PASSWORD_CHANGE_KEY = 'allowPasswordChange';
export const PERMISSIONS_KEY = 'permissions';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const AllowPasswordChangeRequired = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new Error('Authentication context is unavailable.');
    return request.auth;
  },
);

export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WorkspaceContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.workspace) throw new Error('Workspace context is unavailable.');
    return request.workspace;
  },
);
