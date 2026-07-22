import type { AuthUser, SafeUserSummary } from '@ai-content-os/contracts';
import { permissionsForRole } from '../../common/auth/permissions';

interface SafeUserInput {
  id: string;
  email: string;
  displayName: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthUserInput extends SafeUserInput {
  workspaceMembers: Array<{
    role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'REVIEWER' | 'SEO_MANAGER' | 'WRITER' | 'VIEWER';
    workspace: { id: string; name: string; slug: string; isActive: boolean };
  }>;
}

export function presentUser(user: SafeUserInput): SafeUserSummary {
  return {
    id: user.id,
    email: user.email,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt.toISOString() } : {}),
    ...(user.passwordChangedAt ? { passwordChangedAt: user.passwordChangedAt.toISOString() } : {}),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function presentAuthUser(user: AuthUserInput): AuthUser {
  return {
    ...presentUser(user),
    workspaces: user.workspaceMembers
      .filter((membership) => membership.workspace.isActive)
      .map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        role: membership.role,
        permissions: permissionsForRole(membership.role),
      })),
  };
}
