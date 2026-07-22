export type HealthState = 'ok' | 'degraded' | 'unavailable';

export interface DependencyHealth {
  status: 'up' | 'down';
}

export interface HealthResponse {
  status: HealthState;
  timestamp: string;
  services?: Record<string, DependencyHealth>;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details: ApiErrorDetail[];
    requestId: string;
  };
  timestamp: string;
  path: string;
}

export interface PaginationResponse<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export type UserStatus = 'ACTIVE' | 'INACTIVE';
export type WorkspaceRole =
  'OWNER' | 'ADMIN' | 'EDITOR' | 'REVIEWER' | 'SEO_MANAGER' | 'WRITER' | 'VIEWER';

export type Permission =
  | 'workspace.read'
  | 'workspace.update'
  | 'workspace.deactivate'
  | 'members.read'
  | 'members.create'
  | 'members.update'
  | 'members.delete'
  | 'users.read'
  | 'users.create'
  | 'users.update'
  | 'users.deactivate'
  | 'users.resetPassword'
  | 'websites.read'
  | 'websites.create'
  | 'websites.update'
  | 'websites.delete'
  | 'contentProfiles.read'
  | 'contentProfiles.create'
  | 'contentProfiles.update'
  | 'contentProfiles.delete'
  | 'audit.read';

export interface SafeUserSummary {
  id: string;
  email: string;
  displayName?: string;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt?: string;
  passwordChangedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser extends SafeUserSummary {
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: WorkspaceRole;
    permissions: Permission[];
  }>;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: string;
  lastUsedAt: string;
  createdAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  deactivatedAt?: string;
  role: WorkspaceRole;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemberSummary {
  id: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
  user: SafeUserSummary;
}

export type WebsitePlatform = 'BLOGGER' | 'WORDPRESS' | 'OTHER';
export type WebsiteStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';

export interface WebsiteSummary {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  platform: WebsitePlatform;
  language: string;
  locale?: string;
  timezone: string;
  description?: string;
  status: WebsiteStatus;
  createdAt: string;
  updatedAt: string;
}

export type ContentProfileStatus = 'ACTIVE' | 'INACTIVE';

export interface ContentProfileSummary {
  id: string;
  workspaceId: string;
  websiteId: string;
  name: string;
  language: string;
  locale?: string;
  countryCode?: string;
  tone: string;
  targetAudience?: string;
  editorialRules: unknown;
  prohibitedTopics?: unknown;
  isDefault: boolean;
  status: ContentProfileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TemporaryPasswordResponse {
  user: SafeUserSummary;
  temporaryPassword: string;
}

export interface AuditLogSummary {
  id: string;
  actorUserId?: string;
  workspaceId?: string;
  websiteId?: string;
  targetType?: string;
  targetId?: string;
  action: string;
  requestId?: string;
  metadata?: unknown;
  createdAt: string;
}

export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';

export interface JobStatusResponse {
  id: string;
  name: string;
  state: JobState;
  correlationId: string;
  result?: unknown;
  failedReason?: string;
}
