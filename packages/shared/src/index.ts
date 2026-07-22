export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export const SERVICE_NAMES = {
  api: 'api',
  worker: 'worker',
  database: 'database',
  redis: 'redis',
  queue: 'queue',
} as const;

export const QUEUE_NAMES = { system: 'system' } as const;
export const JOB_NAMES = { healthCheck: 'system.health-check' } as const;

export const ERROR_CODES = {
  validation: 'VALIDATION_ERROR',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  internal: 'INTERNAL_ERROR',
  infrastructureUnavailable: 'INFRASTRUCTURE_UNAVAILABLE',
  authInvalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  authSessionExpired: 'AUTH_SESSION_EXPIRED',
  authSessionRevoked: 'AUTH_SESSION_REVOKED',
  authPasswordChangeRequired: 'AUTH_PASSWORD_CHANGE_REQUIRED',
  rateLimitExceeded: 'RATE_LIMIT_EXCEEDED',
  userInactive: 'USER_INACTIVE',
  userEmailConflict: 'USER_EMAIL_CONFLICT',
  workspaceNotFound: 'WORKSPACE_NOT_FOUND',
  workspaceAccessDenied: 'WORKSPACE_ACCESS_DENIED',
  workspaceLastOwner: 'WORKSPACE_LAST_OWNER',
  memberAlreadyExists: 'MEMBER_ALREADY_EXISTS',
  memberRoleForbidden: 'MEMBER_ROLE_FORBIDDEN',
  websiteSlugConflict: 'WEBSITE_SLUG_CONFLICT',
  contentProfileDefaultConflict: 'CONTENT_PROFILE_DEFAULT_CONFLICT',
} as const;

export type CorrelationId = string;

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const toIsoDate = (date: Date = new Date()): string => date.toISOString();
