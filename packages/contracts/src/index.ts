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
  | 'contents.read'
  | 'contents.create'
  | 'contents.update'
  | 'contents.assign'
  | 'contents.transition'
  | 'contents.archive'
  | 'contents.revisions.read'
  | 'contents.seo.update'
  | 'contents.comments.read'
  | 'contents.comments.create'
  | 'contents.comments.resolve'
  | 'contents.reviews.read'
  | 'contents.reviews.approve'
  | 'contents.reviews.requestChanges'
  | 'contents.publication.read'
  | 'contents.publication.createDraft'
  | 'contents.publication.updateDraft'
  | 'integrations.read'
  | 'integrations.connect'
  | 'integrations.update'
  | 'integrations.disconnect'
  | 'integrations.test'
  | 'integrations.sync'
  | 'externalPosts.read'
  | 'externalPosts.import'
  | 'providerPublishing.createDraft'
  | 'providerPublishing.update'
  | 'providerPublishing.publish'
  | 'providerPublishing.delete'
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

export type ContentEditorialStatus =
  | 'IDEA'
  | 'RESEARCHING'
  | 'OUTLINED'
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'READY_TO_PUBLISH'
  | 'PUBLISHED'
  | 'ARCHIVED';

export type ContentPublicationStatus =
  'NOT_PUBLISHED' | 'DRAFT_SENT' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED';

export interface ContentItemSummary {
  id: string;
  workspaceId: string;
  websiteId: string;
  contentProfileId?: string;
  title: string;
  slug: string;
  excerpt?: string;
  htmlContent: string;
  plainTextContent: string;
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  language: string;
  locale?: string;
  featuredImageReference?: string;
  labels: string[];
  wordCount: number;
  estimatedReadingMinutes: number;
  editorialStatus: ContentEditorialStatus;
  publicationStatus: ContentPublicationStatus;
  version: number;
  createdByUserId: string;
  assignedToUserId?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRevisionSummary {
  id: string;
  contentItemId: string;
  revisionNumber: number;
  title: string;
  slug: string;
  excerpt?: string;
  htmlContent: string;
  plainTextContent: string;
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  language: string;
  locale?: string;
  featuredImageReference?: string;
  labels: string[];
  wordCount: number;
  estimatedReadingMinutes: number;
  editorialStatus: ContentEditorialStatus;
  publicationStatus: ContentPublicationStatus;
  assignedToUserId?: string;
  contentProfileId?: string;
  changedByUserId: string;
  changeReason?: string;
  changedAt: string;
}

export type ContentCommentStatus = 'OPEN' | 'RESOLVED';

export interface ContentCommentSummary {
  id: string;
  contentItemId: string;
  authorUserId: string;
  authorDisplayName?: string;
  message: string;
  status: ContentCommentStatus;
  resolvedAt?: string;
  resolvedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ContentReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED';

export interface ContentReviewSummary {
  id: string;
  contentItemId: string;
  reviewerUserId: string;
  reviewerDisplayName?: string;
  decision: ContentReviewDecision;
  note?: string;
  reviewedRevisionNumber: number;
  createdAt: string;
}

export type ReviewCenterQueue =
  'TO_WRITE' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'READY_TO_PUBLISH';

export interface ReviewCenterResponse extends PaginationResponse<ContentItemSummary> {
  queueCounts: Record<ReviewCenterQueue, number>;
}

export type ContentPublicationSyncState =
  'NOT_CONNECTED' | 'DRAFT_CREATED' | 'OUT_OF_SYNC' | 'SYNCHRONIZED' | 'ERROR' | 'MISSING';

export interface ContentPublicationSummary {
  contentItemId: string;
  provider: 'BLOGGER';
  connectionStatus?: IntegrationConnectionStatus;
  externalSiteName?: string;
  associationId?: string;
  externalDraftExists: boolean;
  bindingStatus?: 'PENDING' | 'ACTIVE' | 'MISSING' | 'ERROR';
  synchronizedRevisionNumber?: number;
  currentRevisionNumber: number;
  synchronization: ContentPublicationSyncState;
  lastErrorCode?: string;
  publicPublishEnabled: boolean;
  deleteEnabled: boolean;
  updatedAt?: string;
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

export type ProviderMode = 'MOCK' | 'LIVE';
export type PublishingProviderName = 'BLOGGER' | 'WORDPRESS' | 'OTHER';
export type IntegrationConnectionStatus =
  'PENDING' | 'CONNECTED' | 'DEGRADED' | 'EXPIRED' | 'REVOKED' | 'DISCONNECTED';
export type ProviderPostStatus = 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'DELETED';

export interface IntegrationSystemStatus {
  bloggerMode: ProviderMode;
  publicPublishEnabled: boolean;
  deleteEnabled: boolean;
}

export interface IntegrationSummary {
  id: string;
  workspaceId: string;
  websiteId: string;
  provider: PublishingProviderName;
  mode: ProviderMode;
  status: IntegrationConnectionStatus;
  externalAccountId?: string;
  externalSiteId?: string;
  externalSiteName?: string;
  externalSiteUrl?: string;
  grantedScopes: string[];
  connectedAt?: string;
  lastTestedAt?: string;
  lastSuccessfulSyncAt?: string;
  expiresAt?: string;
  lastErrorCode?: string;
  lastErrorAt?: string;
  publicPublishEnabled: boolean;
  deleteEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizationRequest {
  state: string;
  redirectUri: string;
  scopes: string[];
}

export interface AuthorizationUrlResult {
  url: string;
}

export interface AuthorizationCallbackRequest {
  code: string;
  state: string;
  redirectUri: string;
}

export interface ProviderCredential {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  scopes: string[];
}

export interface AuthorizationCallbackResult {
  externalAccountId: string;
  accountEmail?: string;
  credentials?: ProviderCredential;
  grantedScopes: string[];
}

export type MockProviderSimulation =
  | 'TOKEN_EXPIRED'
  | 'REFRESH_FAILURE'
  | 'RATE_LIMIT'
  | 'PERMISSION_DENIED'
  | 'SITE_NOT_FOUND'
  | 'POST_NOT_FOUND'
  | 'UPSTREAM_UNAVAILABLE';

export interface ProviderConnectionContext {
  connectionId: string;
  mode: ProviderMode;
  workspaceId?: string;
  websiteId?: string;
  correlationId?: string;
  credentials?: ProviderCredential;
  externalAccountId?: string;
  externalSiteId?: string;
  simulation?: MockProviderSimulation;
}

export interface TokenRefreshResult {
  credentials: ProviderCredential;
}

export interface ConnectionTestResult {
  ok: boolean;
  checkedAt: string;
  externalAccountId?: string;
  externalSiteId?: string;
}

export interface ProviderPaginationInput {
  pageSize?: number;
  pageToken?: string;
}

export interface ProviderSite {
  id: string;
  name: string;
  url: string;
  language?: string;
  description?: string;
}

export interface ProviderSitePage {
  items: ProviderSite[];
  nextPageToken?: string;
}

export interface ProviderTaxonomyResult {
  labels: Array<{ name: string; usageCount: number }>;
}

export interface ProviderPost {
  id: string;
  siteId: string;
  title: string;
  htmlContent: string;
  url?: string;
  status: ProviderPostStatus;
  labels: string[];
  publishedAt?: string;
  updatedAt: string;
}

export interface ProviderPostPage {
  items: ProviderPost[];
  nextPageToken?: string;
}

export interface CreateProviderDraftInput {
  externalSiteId: string;
  title: string;
  htmlContent: string;
  labels: string[];
  idempotencyKey: string;
}

export interface UpdateProviderPostInput extends CreateProviderDraftInput {
  externalPostId: string;
}

export interface PublishProviderPostInput {
  externalSiteId: string;
  externalPostId: string;
  idempotencyKey: string;
}

export type DeleteProviderPostInput = PublishProviderPostInput;

export interface ProviderPostMutationResult {
  post: ProviderPost;
  created: boolean;
}

export interface PublishingProvider {
  getAuthorizationUrl(input: AuthorizationRequest): Promise<AuthorizationUrlResult>;
  handleAuthorizationCallback(
    input: AuthorizationCallbackRequest,
  ): Promise<AuthorizationCallbackResult>;
  refreshConnection(connection: ProviderConnectionContext): Promise<TokenRefreshResult>;
  testConnection(connection: ProviderConnectionContext): Promise<ConnectionTestResult>;
  listSites(
    connection: ProviderConnectionContext,
    pagination?: ProviderPaginationInput,
  ): Promise<ProviderSitePage>;
  getSite(connection: ProviderConnectionContext, externalSiteId: string): Promise<ProviderSite>;
  listTaxonomy(
    connection: ProviderConnectionContext,
    externalSiteId: string,
  ): Promise<ProviderTaxonomyResult>;
  listPosts(
    connection: ProviderConnectionContext,
    externalSiteId: string,
    pagination?: ProviderPaginationInput,
  ): Promise<ProviderPostPage>;
  getPost(
    connection: ProviderConnectionContext,
    externalSiteId: string,
    externalPostId: string,
  ): Promise<ProviderPost>;
  createDraft(
    connection: ProviderConnectionContext,
    input: CreateProviderDraftInput,
  ): Promise<ProviderPostMutationResult>;
  updatePost(
    connection: ProviderConnectionContext,
    input: UpdateProviderPostInput,
  ): Promise<ProviderPostMutationResult>;
  publishPost(
    connection: ProviderConnectionContext,
    input: PublishProviderPostInput,
  ): Promise<ProviderPostMutationResult>;
  deletePost(connection: ProviderConnectionContext, input: DeleteProviderPostInput): Promise<void>;
}

export type DiscoveredBloggerBlog = ProviderSite;

export interface ExternalPostSummary {
  id: string;
  externalPostId: string;
  externalBlogId: string;
  title: string;
  externalUrl?: string;
  status: ProviderPostStatus;
  labels: string[];
  publishedAt?: string;
  updatedExternallyAt?: string;
  lastImportedAt: string;
  deletedExternallyAt?: string;
}

export interface ExternalLabelSummary {
  id: string;
  name: string;
  normalizedName: string;
  usageCount: number;
  lastSeenAt: string;
}

export interface IntegrationSyncRunSummary {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  correlationId: string;
  externalJobId?: string;
  startedAt?: string;
  completedAt?: string;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  errorCode?: string;
  safeErrorMessage?: string;
  createdAt: string;
}

export interface StartBloggerConnectionResult {
  authorizationUrl: string;
  expiresAt: string;
}

export interface PublicationOperationResult {
  operationId: string;
  idempotencyKey: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  post?: ExternalPostSummary;
}

export interface CurrentBloggerTestPublication {
  publicationId: string;
  externalPostId: string;
  title: string;
  htmlContent: string;
  labels: string[];
  status: ProviderPostStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BloggerSyncJobData {
  syncRunId: string;
  workspaceId: string;
  websiteId: string;
  connectionId: string;
  correlationId: string;
}

export interface BloggerSyncJobResult {
  syncRunId: string;
  correlationId: string;
  status: 'COMPLETED' | 'FAILED';
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  errorCode?: string;
}
