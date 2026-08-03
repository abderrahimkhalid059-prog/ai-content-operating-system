import type {
  AuthorizationCallbackRequest,
  AuthorizationCallbackResult,
  AuthorizationRequest,
  AuthorizationUrlResult,
  ConnectionTestResult,
  CreateProviderDraftInput,
  DeleteProviderPostInput,
  ProviderConnectionContext,
  ProviderCredential,
  ProviderPaginationInput,
  ProviderPost,
  ProviderPostMutationResult,
  ProviderPostPage,
  ProviderSite,
  ProviderSitePage,
  ProviderTaxonomyResult,
  PublishProviderPostInput,
  PublishingProvider,
  TokenRefreshResult,
  UpdateProviderPostInput,
} from '@ai-content-os/contracts';
import { ProviderError } from './errors';

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
}

export interface HttpTransport {
  request<T>(input: HttpRequest): Promise<HttpResponse<T>>;
}

export class FetchHttpTransport implements HttpTransport {
  async request<T>(input: HttpRequest): Promise<HttpResponse<T>> {
    try {
      const response = await fetch(input.url, {
        method: input.method ?? 'GET',
        signal: AbortSignal.timeout(input.timeoutMs),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.body ? { body: input.body } : {}),
      });
      const body = (await response.json().catch(() => ({}))) as T;
      return { status: response.status, body };
    } catch {
      throw new ProviderError(
        'BLOGGER_UPSTREAM_UNAVAILABLE',
        'Blogger is temporarily unavailable.',
        true,
      );
    }
  }
}

export interface LiveBloggerConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  timeoutMs: number;
}

export interface BloggerProviderDiagnostic {
  operation: string;
  googleHttpStatus: number;
  connectionId?: string;
  workspaceId?: string;
  websiteId?: string;
  requestId?: string;
  correlationId?: string;
  googleReason?: string;
  returnedBlogs?: number;
  activeBlogIdPresent?: boolean;
  externalPostIdPresent?: boolean;
  requestedView?: 'ADMIN';
  fallbackDraftResultCount?: number;
  targetExternalPostIdFound?: boolean;
}

export type BloggerProviderDiagnosticSink = (diagnostic: BloggerProviderDiagnostic) => void;

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface GoogleBlog {
  id: string;
  name: string;
  url: string;
  locale?: { language?: string };
  description?: string;
}

interface GoogleBlogList {
  kind: 'blogger#blogList';
  items?: GoogleBlog[];
}

interface GoogleUser {
  kind: 'blogger#user';
  id: string;
}

interface GooglePost {
  id: string;
  blog: { id: string };
  title: string;
  content?: string;
  url?: string;
  status?: string;
  labels?: string[];
  published?: string;
  updated?: string;
}

interface GooglePostList {
  items?: GooglePost[];
  nextPageToken?: string;
}

export class LiveBloggerProvider implements PublishingProvider {
  constructor(
    private readonly config: LiveBloggerConfig,
    private readonly transport: HttpTransport = new FetchHttpTransport(),
    private readonly diagnostics: BloggerProviderDiagnosticSink = () => undefined,
  ) {}

  getAuthorizationUrl(input: AuthorizationRequest): Promise<AuthorizationUrlResult> {
    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', input.scopes.join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return Promise.resolve({ url: url.toString() });
  }

  async handleAuthorizationCallback(
    input: AuthorizationCallbackRequest,
  ): Promise<AuthorizationCallbackResult> {
    const result = await this.transport.request<GoogleTokenResponse>({
      url: this.config.tokenUrl,
      method: 'POST',
      timeoutMs: this.config.timeoutMs,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    this.assertSuccess(result.status, 'authorization');
    const credentials = this.credentials(result.body);
    return {
      externalAccountId: 'google-account',
      credentials,
      grantedScopes: credentials.scopes,
    };
  }

  async refreshConnection(connection: ProviderConnectionContext): Promise<TokenRefreshResult> {
    const refreshToken = connection.credentials?.refreshToken;
    if (!refreshToken) {
      throw new ProviderError(
        'BLOGGER_TOKEN_REFRESH_FAILED',
        'No refresh credential is available.',
      );
    }
    const result = await this.transport.request<GoogleTokenResponse>({
      url: this.config.tokenUrl,
      method: 'POST',
      timeoutMs: this.config.timeoutMs,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (result.status < 200 || result.status >= 300) {
      throw new ProviderError(
        'BLOGGER_TOKEN_REFRESH_FAILED',
        'Google token refresh failed.',
        result.status >= 500,
        result.status,
      );
    }
    return {
      credentials: {
        ...this.credentials(result.body),
        refreshToken,
      },
    };
  }

  async testConnection(connection: ProviderConnectionContext): Promise<ConnectionTestResult> {
    const sites = await this.listSites(connection, { pageSize: 1 });
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      ...(connection.externalAccountId ? { externalAccountId: connection.externalAccountId } : {}),
      ...((connection.externalSiteId ?? sites.items[0]?.id)
        ? { externalSiteId: connection.externalSiteId ?? sites.items[0]!.id }
        : {}),
    };
  }

  async listSites(
    connection: ProviderConnectionContext,
    pagination?: ProviderPaginationInput,
  ): Promise<ProviderSitePage> {
    void pagination;
    const identityUrl = new URL(`${this.apiBaseUrl()}/users/self`);
    const identityResponse = await this.discoveryResponse(
      connection,
      identityUrl,
      'blogger.users.self',
    );
    const identityReason = this.googleReason(identityResponse.body);
    if (identityResponse.status < 200 || identityResponse.status >= 300) {
      this.diagnostic(connection, 'blogger.users.self', identityResponse.status, {
        ...(identityReason ? { reason: identityReason } : {}),
      });
    }
    this.assertSuccess(identityResponse.status, 'identity', identityResponse.body);
    if (!this.isGoogleUser(identityResponse.body)) {
      this.diagnostic(connection, 'blogger.users.self', identityResponse.status, {
        reason: 'malformed_response',
      });
      throw this.malformedResponse();
    }
    this.diagnostic(connection, 'blogger.users.self', identityResponse.status);

    const blogsUrl = new URL(`${this.apiBaseUrl()}/users/self/blogs`);
    const blogsResponse = await this.discoveryResponse(
      connection,
      blogsUrl,
      'blogger.users.self.blogs',
    );
    const blogsReason = this.googleReason(blogsResponse.body);
    if (blogsResponse.status < 200 || blogsResponse.status >= 300) {
      this.diagnostic(connection, 'blogger.users.self.blogs', blogsResponse.status, {
        ...(blogsReason ? { reason: blogsReason } : {}),
      });
    }
    this.assertSuccess(blogsResponse.status, 'sites', blogsResponse.body);
    if (!this.isGoogleBlogList(blogsResponse.body)) {
      this.diagnostic(connection, 'blogger.users.self.blogs', blogsResponse.status, {
        reason: 'malformed_response',
      });
      throw this.malformedResponse();
    }
    const items = blogsResponse.body.items ?? [];
    this.diagnostic(connection, 'blogger.users.self.blogs', blogsResponse.status, {
      returnedBlogs: items.length,
    });
    return {
      items: items.map((site) => this.site(site)),
    };
  }

  private async discoveryResponse(
    connection: ProviderConnectionContext,
    url: URL,
    operation: string,
  ): Promise<HttpResponse<unknown>> {
    try {
      return await this.response<unknown>(connection, url);
    } catch (error) {
      const reason =
        error instanceof ProviderError ? (error.reason ?? error.code) : 'network_failure';
      this.diagnostic(
        connection,
        operation,
        error instanceof ProviderError ? (error.status ?? 0) : 0,
        {
          reason,
        },
      );
      throw error;
    }
  }

  async getSite(
    connection: ProviderConnectionContext,
    externalSiteId: string,
  ): Promise<ProviderSite> {
    const result = await this.request<GoogleBlog>(
      connection,
      new URL(`${this.config.apiBaseUrl}/blogs/${encodeURIComponent(externalSiteId)}`),
      undefined,
      'site',
    );
    return this.site(result);
  }

  async listTaxonomy(
    connection: ProviderConnectionContext,
    externalSiteId: string,
  ): Promise<ProviderTaxonomyResult> {
    const usage = new Map<string, number>();
    let pageToken: string | undefined;
    do {
      const page = await this.listPosts(connection, externalSiteId, {
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const post of page.items) {
        for (const label of post.labels) usage.set(label, (usage.get(label) ?? 0) + 1);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { labels: [...usage].map(([name, usageCount]) => ({ name, usageCount })) };
  }

  async listPosts(
    connection: ProviderConnectionContext,
    externalSiteId: string,
    pagination: ProviderPaginationInput = {},
  ): Promise<ProviderPostPage> {
    const url = new URL(
      `${this.config.apiBaseUrl}/blogs/${encodeURIComponent(externalSiteId)}/posts`,
    );
    url.searchParams.append('status', 'live');
    url.searchParams.append('status', 'draft');
    url.searchParams.set('fetchBodies', 'true');
    if (pagination.pageSize) url.searchParams.set('maxResults', String(pagination.pageSize));
    if (pagination.pageToken) url.searchParams.set('pageToken', pagination.pageToken);
    const result = await this.request<{ items?: GooglePost[]; nextPageToken?: string }>(
      connection,
      url,
    );
    return {
      items: (result.items ?? []).map((post) => this.post(post)),
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    };
  }

  async getPost(
    connection: ProviderConnectionContext,
    externalSiteId: string,
    externalPostId: string,
  ): Promise<ProviderPost> {
    const postUrl = new URL(
      `${this.apiBaseUrl()}/blogs/${encodeURIComponent(externalSiteId)}/posts/${encodeURIComponent(externalPostId)}`,
    );
    postUrl.searchParams.set('view', 'ADMIN');
    const result = await this.response<unknown>(connection, postUrl);
    this.postDiagnostic(
      connection,
      'blogger.posts.get',
      result.status,
      externalSiteId,
      externalPostId,
      {
        requestedView: 'ADMIN',
      },
    );

    if (result.status >= 200 && result.status < 300) {
      const post = this.validatedPost(result.body, externalSiteId, externalPostId);
      return this.post(post);
    }
    if (result.status !== 404) {
      this.assertSuccess(result.status, 'post', result.body);
    }

    const fallback = await this.findDraftInAdminList(connection, externalSiteId, externalPostId);
    if (fallback) return this.post(fallback);

    this.assertSuccess(result.status, 'post', result.body);
    throw this.malformedResponse();
  }

  async createDraft(
    connection: ProviderConnectionContext,
    input: CreateProviderDraftInput,
  ): Promise<ProviderPostMutationResult> {
    const url = new URL(
      `${this.config.apiBaseUrl}/blogs/${encodeURIComponent(input.externalSiteId)}/posts`,
    );
    url.searchParams.set('isDraft', 'true');
    const result = await this.request<GooglePost>(connection, url, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'blogger#post',
        blog: { id: input.externalSiteId },
        title: input.title,
        content: input.htmlContent,
        labels: input.labels,
      }),
    });
    return { post: this.post(result), created: true };
  }

  async updatePost(
    connection: ProviderConnectionContext,
    input: UpdateProviderPostInput,
  ): Promise<ProviderPostMutationResult> {
    const result = await this.request<GooglePost>(
      connection,
      new URL(
        `${this.config.apiBaseUrl}/blogs/${encodeURIComponent(input.externalSiteId)}/posts/${encodeURIComponent(input.externalPostId)}`,
      ),
      {
        method: 'PUT',
        body: JSON.stringify({
          kind: 'blogger#post',
          id: input.externalPostId,
          blog: { id: input.externalSiteId },
          title: input.title,
          content: input.htmlContent,
          labels: input.labels,
        }),
      },
    );
    return { post: this.post(result), created: false };
  }

  async publishPost(
    connection: ProviderConnectionContext,
    input: PublishProviderPostInput,
  ): Promise<ProviderPostMutationResult> {
    const result = await this.request<GooglePost>(
      connection,
      new URL(
        `${this.config.apiBaseUrl}/blogs/${encodeURIComponent(input.externalSiteId)}/posts/${encodeURIComponent(input.externalPostId)}/publish`,
      ),
      { method: 'POST' },
    );
    return { post: this.post(result), created: false };
  }

  async deletePost(
    connection: ProviderConnectionContext,
    input: DeleteProviderPostInput,
  ): Promise<void> {
    await this.request<unknown>(
      connection,
      new URL(
        `${this.config.apiBaseUrl}/blogs/${encodeURIComponent(input.externalSiteId)}/posts/${encodeURIComponent(input.externalPostId)}`,
      ),
      { method: 'DELETE' },
    );
  }

  private async request<T>(
    connection: ProviderConnectionContext,
    url: URL,
    init?: Pick<HttpRequest, 'method' | 'body'>,
    resource?: 'site' | 'post',
  ): Promise<T> {
    const result = await this.response<T>(connection, url, init);
    this.assertSuccess(result.status, resource, result.body);
    return result.body;
  }

  private async response<T>(
    connection: ProviderConnectionContext,
    url: URL,
    init?: Pick<HttpRequest, 'method' | 'body'>,
  ): Promise<HttpResponse<T>> {
    const accessToken = connection.credentials?.accessToken;
    if (!accessToken) {
      throw new ProviderError(
        'INTEGRATION_CONNECTION_EXPIRED',
        'The Blogger connection has no usable access credential.',
      );
    }
    return this.transport.request<T>({
      url: url.toString(),
      timeoutMs: this.config.timeoutMs,
      ...(init?.method ? { method: init.method } : {}),
      ...(init?.body ? { body: init.body } : {}),
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  }

  private async findDraftInAdminList(
    connection: ProviderConnectionContext,
    externalSiteId: string,
    externalPostId: string,
  ): Promise<GooglePost | null> {
    let pageToken: string | undefined;
    let fallbackDraftResultCount = 0;
    let fallbackGoogleHttpStatus = 0;
    const seenPageTokens = new Set<string>();

    do {
      const url = new URL(`${this.apiBaseUrl()}/blogs/${encodeURIComponent(externalSiteId)}/posts`);
      url.searchParams.set('status', 'draft');
      url.searchParams.set('view', 'ADMIN');
      url.searchParams.set('fetchBodies', 'true');
      url.searchParams.set('maxResults', '500');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const response = await this.response<unknown>(connection, url);
      fallbackGoogleHttpStatus = response.status;
      if (response.status < 200 || response.status >= 300) {
        this.postDiagnostic(
          connection,
          'blogger.posts.listDraftsForRecovery',
          response.status,
          externalSiteId,
          externalPostId,
          {
            requestedView: 'ADMIN',
            fallbackDraftResultCount,
            targetExternalPostIdFound: false,
          },
        );
        this.assertSuccess(response.status, 'site', response.body);
      }
      if (!this.isGooglePostList(response.body)) {
        this.postDiagnostic(
          connection,
          'blogger.posts.listDraftsForRecovery',
          response.status,
          externalSiteId,
          externalPostId,
          {
            requestedView: 'ADMIN',
            fallbackDraftResultCount,
            targetExternalPostIdFound: false,
          },
        );
        throw this.malformedResponse();
      }

      const items = response.body.items ?? [];
      fallbackDraftResultCount += items.length;
      const found = items.find(({ id }) => id === externalPostId);
      if (found) {
        const post = this.validatedPost(found, externalSiteId, externalPostId);
        this.postDiagnostic(
          connection,
          'blogger.posts.listDraftsForRecovery',
          response.status,
          externalSiteId,
          externalPostId,
          {
            requestedView: 'ADMIN',
            fallbackDraftResultCount,
            targetExternalPostIdFound: true,
          },
        );
        return post;
      }

      pageToken = response.body.nextPageToken;
      if (pageToken) {
        if (seenPageTokens.has(pageToken)) throw this.malformedResponse();
        seenPageTokens.add(pageToken);
      }
    } while (pageToken);

    this.postDiagnostic(
      connection,
      'blogger.posts.listDraftsForRecovery',
      fallbackGoogleHttpStatus,
      externalSiteId,
      externalPostId,
      {
        requestedView: 'ADMIN',
        fallbackDraftResultCount,
        targetExternalPostIdFound: false,
      },
    );
    return null;
  }

  private assertSuccess(status: number, resource?: string, body?: unknown): void {
    if (status >= 200 && status < 300) return;
    const reason = this.googleReason(body);
    if (status === 401)
      throw new ProviderError(
        'BLOGGER_ACCOUNT_UNAUTHORIZED',
        'Google authorization failed.',
        false,
        status,
        reason,
      );
    if (status === 403) {
      const apiDisabled = reason
        ? ['accessnotconfigured', 'service_disabled', 'api_disabled'].includes(reason.toLowerCase())
        : false;
      throw new ProviderError(
        'BLOGGER_PERMISSION_DENIED',
        apiDisabled
          ? 'The Blogger API is not enabled for this Google project.'
          : 'Blogger permission was denied.',
        false,
        status,
        reason,
      );
    }
    if (status === 404)
      throw new ProviderError(
        resource === 'post' ? 'BLOGGER_POST_NOT_FOUND' : 'BLOGGER_BLOG_NOT_FOUND',
        resource === 'post' ? 'Blogger post was not found.' : 'Blogger site was not found.',
        false,
        status,
        reason,
      );
    if (status === 429)
      throw new ProviderError(
        'BLOGGER_RATE_LIMITED',
        'Blogger rate limit reached.',
        true,
        status,
        reason,
      );
    if (status >= 500)
      throw new ProviderError(
        'BLOGGER_UPSTREAM_UNAVAILABLE',
        'Blogger is temporarily unavailable.',
        true,
        status,
        reason,
      );
    throw new ProviderError(
      'BLOGGER_UPSTREAM_UNAVAILABLE',
      'Blogger request failed.',
      false,
      status,
      reason,
    );
  }

  private apiBaseUrl(): string {
    return this.config.apiBaseUrl.replace(/\/+$/, '');
  }

  private isGoogleUser(body: unknown): body is GoogleUser {
    return (
      this.isRecord(body) &&
      body.kind === 'blogger#user' &&
      typeof body.id === 'string' &&
      body.id.length > 0
    );
  }

  private isGoogleBlogList(body: unknown): body is GoogleBlogList {
    if (!this.isRecord(body) || body.kind !== 'blogger#blogList') return false;
    if (body.items === undefined) return true;
    return (
      Array.isArray(body.items) &&
      body.items.every(
        (item) =>
          this.isRecord(item) &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          typeof item.name === 'string' &&
          item.name.length > 0 &&
          typeof item.url === 'string' &&
          item.url.length > 0,
      )
    );
  }

  private isGooglePostList(body: unknown): body is GooglePostList {
    return (
      this.isRecord(body) &&
      (body.items === undefined ||
        (Array.isArray(body.items) && body.items.every((item) => this.isGooglePost(item)))) &&
      (body.nextPageToken === undefined || typeof body.nextPageToken === 'string')
    );
  }

  private isGooglePost(body: unknown): body is GooglePost {
    return (
      this.isRecord(body) &&
      typeof body.id === 'string' &&
      this.isRecord(body.blog) &&
      typeof body.blog.id === 'string' &&
      typeof body.title === 'string' &&
      (body.content === undefined || typeof body.content === 'string') &&
      (body.status === undefined || typeof body.status === 'string') &&
      (body.labels === undefined ||
        (Array.isArray(body.labels) && body.labels.every((label) => typeof label === 'string'))) &&
      (body.url === undefined || typeof body.url === 'string') &&
      (body.published === undefined || typeof body.published === 'string') &&
      (body.updated === undefined || typeof body.updated === 'string')
    );
  }

  private validatedPost(body: unknown, externalSiteId: string, externalPostId: string): GooglePost {
    if (!this.isGooglePost(body) || body.blog.id !== externalSiteId || body.id !== externalPostId) {
      throw this.malformedResponse();
    }
    return body;
  }

  private googleReason(body: unknown): string | undefined {
    if (!this.isRecord(body) || !this.isRecord(body.error)) return undefined;
    const error = body.error;
    const errors = Array.isArray(error.errors) ? error.errors : [];
    const details = Array.isArray(error.details) ? error.details : [];
    const firstError = errors.find((value) => this.isRecord(value));
    const firstDetail = details.find((value) => this.isRecord(value));
    const candidate =
      (this.isRecord(firstError) ? firstError.reason : undefined) ??
      (this.isRecord(firstDetail) ? firstDetail.reason : undefined) ??
      error.status ??
      error.code;
    if (typeof candidate !== 'string' && typeof candidate !== 'number') return undefined;
    const reason = String(candidate);
    return reason.length <= 100 && /^[A-Za-z0-9._:-]+$/.test(reason) ? reason : undefined;
  }

  private diagnostic(
    connection: ProviderConnectionContext,
    operation: string,
    googleHttpStatus: number,
    details: { reason?: string; returnedBlogs?: number } = {},
  ): void {
    this.diagnostics({
      operation,
      googleHttpStatus,
      connectionId: connection.connectionId,
      ...(connection.workspaceId ? { workspaceId: connection.workspaceId } : {}),
      ...(connection.websiteId ? { websiteId: connection.websiteId } : {}),
      ...(connection.correlationId ? { requestId: connection.correlationId } : {}),
      ...(details.reason ? { googleReason: details.reason } : {}),
      ...(details.returnedBlogs !== undefined ? { returnedBlogs: details.returnedBlogs } : {}),
    });
  }

  private postDiagnostic(
    connection: ProviderConnectionContext,
    operation: string,
    googleHttpStatus: number,
    externalSiteId: string,
    externalPostId: string,
    details: {
      requestedView: 'ADMIN';
      fallbackDraftResultCount?: number;
      targetExternalPostIdFound?: boolean;
    },
  ): void {
    this.diagnostics({
      operation,
      googleHttpStatus,
      activeBlogIdPresent: externalSiteId.length > 0,
      externalPostIdPresent: externalPostId.length > 0,
      requestedView: details.requestedView,
      ...(details.fallbackDraftResultCount !== undefined
        ? { fallbackDraftResultCount: details.fallbackDraftResultCount }
        : {}),
      ...(details.targetExternalPostIdFound !== undefined
        ? { targetExternalPostIdFound: details.targetExternalPostIdFound }
        : {}),
      ...(connection.correlationId ? { correlationId: connection.correlationId } : {}),
    });
  }

  private malformedResponse(): ProviderError {
    return new ProviderError(
      'BLOGGER_UPSTREAM_UNAVAILABLE',
      'Google returned a malformed Blogger response.',
      false,
      502,
      'malformed_response',
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private credentials(body: GoogleTokenResponse): ProviderCredential {
    if (!body.access_token) {
      throw new ProviderError('BLOGGER_ACCOUNT_UNAUTHORIZED', 'Google returned no access token.');
    }
    return {
      accessToken: body.access_token,
      ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      tokenType: body.token_type ?? 'Bearer',
      expiresAt: new Date(Date.now() + (body.expires_in ?? 3_600) * 1_000).toISOString(),
      scopes: body.scope?.split(/\s+/).filter(Boolean) ?? [],
    };
  }

  private site(site: GoogleBlog): ProviderSite {
    return {
      id: site.id,
      name: site.name,
      url: site.url,
      ...(site.locale?.language ? { language: site.locale.language } : {}),
      ...(site.description ? { description: site.description } : {}),
    };
  }

  private post(post: GooglePost): ProviderPost {
    const status = post.status?.toLowerCase();
    return {
      id: post.id,
      siteId: post.blog.id,
      title: post.title,
      htmlContent: post.content ?? '',
      ...(post.url ? { url: post.url } : {}),
      status: status === 'draft' ? 'DRAFT' : status === 'scheduled' ? 'SCHEDULED' : 'PUBLISHED',
      labels: post.labels ?? [],
      ...(post.published ? { publishedAt: new Date(post.published).toISOString() } : {}),
      updatedAt: new Date(post.updated ?? Date.now()).toISOString(),
    };
  }
}
