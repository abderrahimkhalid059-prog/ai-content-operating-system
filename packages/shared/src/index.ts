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

export const QUEUE_NAMES = { system: 'system', integrations: 'integrations' } as const;
export const JOB_NAMES = {
  healthCheck: 'system.health-check',
  bloggerSyncSite: 'blogger.sync-site',
} as const;

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
  contentSlugConflict: 'CONTENT_SLUG_CONFLICT',
  contentStaleUpdate: 'CONTENT_STALE_UPDATE',
  contentInvalidTransition: 'CONTENT_INVALID_TRANSITION',
  contentHtmlUnsafe: 'CONTENT_HTML_UNSAFE',
  contentAssignmentInvalid: 'CONTENT_ASSIGNMENT_INVALID',
  contentProfileInvalid: 'CONTENT_PROFILE_INVALID',
  contentReviewStale: 'CONTENT_REVIEW_STALE',
  contentReviewNoteRequired: 'CONTENT_REVIEW_NOTE_REQUIRED',
  contentPublicationNotReady: 'CONTENT_PUBLICATION_NOT_READY',
  contentPublicationConflict: 'CONTENT_PUBLICATION_CONFLICT',
  contentPublicationMissing: 'CONTENT_PUBLICATION_MISSING',
  integrationNotConfigured: 'INTEGRATION_NOT_CONFIGURED',
  integrationModeInvalid: 'INTEGRATION_MODE_INVALID',
  integrationConnectionNotFound: 'INTEGRATION_CONNECTION_NOT_FOUND',
  integrationConnectionExpired: 'INTEGRATION_CONNECTION_EXPIRED',
  integrationCredentialDecryptionFailed: 'INTEGRATION_CREDENTIAL_DECRYPTION_FAILED',
  integrationOAuthStateInvalid: 'INTEGRATION_OAUTH_STATE_INVALID',
  integrationOAuthStateExpired: 'INTEGRATION_OAUTH_STATE_EXPIRED',
  integrationOAuthStateReused: 'INTEGRATION_OAUTH_STATE_REUSED',
  bloggerAccountUnauthorized: 'BLOGGER_ACCOUNT_UNAUTHORIZED',
  bloggerPermissionDenied: 'BLOGGER_PERMISSION_DENIED',
  bloggerBlogNotFound: 'BLOGGER_BLOG_NOT_FOUND',
  bloggerPostNotFound: 'BLOGGER_POST_NOT_FOUND',
  bloggerRateLimited: 'BLOGGER_RATE_LIMITED',
  bloggerUpstreamUnavailable: 'BLOGGER_UPSTREAM_UNAVAILABLE',
  bloggerTokenRefreshFailed: 'BLOGGER_TOKEN_REFRESH_FAILED',
  bloggerDuplicateOperation: 'BLOGGER_DUPLICATE_OPERATION',
  bloggerPublicPublishDisabled: 'BLOGGER_PUBLIC_PUBLISH_DISABLED',
  bloggerDeleteDisabled: 'BLOGGER_DELETE_DISABLED',
  bloggerInvalidHtml: 'BLOGGER_INVALID_HTML',
  bloggerSyncAlreadyRunning: 'BLOGGER_SYNC_ALREADY_RUNNING',
} as const;

export type CorrelationId = string;

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const toIsoDate = (date: Date = new Date()): string => date.toISOString();
