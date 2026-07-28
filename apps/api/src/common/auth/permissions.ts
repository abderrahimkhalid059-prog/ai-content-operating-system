import type { Permission, WorkspaceRole as WorkspaceRoleContract } from '@ai-content-os/contracts';
import { WorkspaceRole } from '@ai-content-os/database';

const allPermissions: Permission[] = [
  'workspace.read',
  'workspace.update',
  'workspace.deactivate',
  'members.read',
  'members.create',
  'members.update',
  'members.delete',
  'users.read',
  'users.create',
  'users.update',
  'users.deactivate',
  'users.resetPassword',
  'websites.read',
  'websites.create',
  'websites.update',
  'websites.delete',
  'contentProfiles.read',
  'contentProfiles.create',
  'contentProfiles.update',
  'contentProfiles.delete',
  'integrations.read',
  'integrations.connect',
  'integrations.update',
  'integrations.disconnect',
  'integrations.test',
  'integrations.sync',
  'externalPosts.read',
  'externalPosts.import',
  'providerPublishing.createDraft',
  'providerPublishing.update',
  'providerPublishing.publish',
  'providerPublishing.delete',
  'audit.read',
];

const readPermissions: Permission[] = [
  'workspace.read',
  'members.read',
  'websites.read',
  'contentProfiles.read',
  'integrations.read',
  'externalPosts.read',
];

export const ROLE_PERMISSIONS: Record<WorkspaceRoleContract, readonly Permission[]> = {
  [WorkspaceRole.OWNER]: allPermissions,
  [WorkspaceRole.ADMIN]: allPermissions.filter(
    (permission) => permission !== 'workspace.deactivate',
  ),
  [WorkspaceRole.EDITOR]: [
    ...readPermissions,
    'websites.create',
    'websites.update',
    'websites.delete',
    'contentProfiles.create',
    'contentProfiles.update',
    'contentProfiles.delete',
    'integrations.test',
    'integrations.sync',
    'externalPosts.import',
    'providerPublishing.createDraft',
    'providerPublishing.update',
  ],
  [WorkspaceRole.REVIEWER]: readPermissions,
  [WorkspaceRole.SEO_MANAGER]: readPermissions,
  [WorkspaceRole.WRITER]: [...readPermissions, 'providerPublishing.createDraft'],
  [WorkspaceRole.VIEWER]: readPermissions,
};

export const permissionsForRole = (role: WorkspaceRoleContract): Permission[] => [
  ...ROLE_PERMISSIONS[role],
];
