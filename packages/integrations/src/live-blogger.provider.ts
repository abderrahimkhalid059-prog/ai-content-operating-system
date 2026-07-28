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

export class LiveBloggerProvider implements PublishingProvider {
  constructor(
    private readonly config: LiveBloggerConfig,
    private readonly transport: HttpTransport = new FetchHttpTransport(),
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
    pagination: ProviderPaginationInput = {},
  ): Promise<ProviderSitePage> {
    const url = new URL(`${this.config.apiBaseUrl}/users/self/blogs`);
    url.searchParams.set('fetchUserInfo', 'true');
    if (pagination.pageSize) url.searchParams.set('maxResults', String(pagination.pageSize));
    if (pagination.pageToken) url.searchParams.set('pageToken', pagination.pageToken);
    const result = await this.request<{ items?: GoogleBlog[]; nextPageToken?: string }>(
      connection,
      url,
    );
    return {
      items: (result.items ?? []).map((site) => this.site(site)),
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    };
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
    const result = await this.request<GooglePost>(
      connection,
      new URL(
        `${this.config.apiBaseUrl}/blogs/${encodeURIComponent(externalSiteId)}/posts/${encodeURIComponent(externalPostId)}`,
      ),
      undefined,
      'post',
    );
    return this.post(result);
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
    const accessToken = connection.credentials?.accessToken;
    if (!accessToken) {
      throw new ProviderError(
        'INTEGRATION_CONNECTION_EXPIRED',
        'The Blogger connection has no usable access credential.',
      );
    }
    const result = await this.transport.request<T>({
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
    this.assertSuccess(result.status, resource);
    return result.body;
  }

  private assertSuccess(status: number, resource?: string): void {
    if (status >= 200 && status < 300) return;
    if (status === 401)
      throw new ProviderError('BLOGGER_ACCOUNT_UNAUTHORIZED', 'Google authorization failed.');
    if (status === 403)
      throw new ProviderError('BLOGGER_PERMISSION_DENIED', 'Blogger permission was denied.');
    if (status === 404)
      throw new ProviderError(
        resource === 'post' ? 'BLOGGER_POST_NOT_FOUND' : 'BLOGGER_BLOG_NOT_FOUND',
        resource === 'post' ? 'Blogger post was not found.' : 'Blogger site was not found.',
      );
    if (status === 429)
      throw new ProviderError('BLOGGER_RATE_LIMITED', 'Blogger rate limit reached.', true, status);
    if (status >= 500)
      throw new ProviderError(
        'BLOGGER_UPSTREAM_UNAVAILABLE',
        'Blogger is temporarily unavailable.',
        true,
        status,
      );
    throw new ProviderError(
      'BLOGGER_UPSTREAM_UNAVAILABLE',
      'Blogger request failed.',
      false,
      status,
    );
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
    return {
      id: post.id,
      siteId: post.blog.id,
      title: post.title,
      htmlContent: post.content ?? '',
      ...(post.url ? { url: post.url } : {}),
      status:
        post.status === 'draft' ? 'DRAFT' : post.status === 'scheduled' ? 'SCHEDULED' : 'PUBLISHED',
      labels: post.labels ?? [],
      ...(post.published ? { publishedAt: new Date(post.published).toISOString() } : {}),
      updatedAt: new Date(post.updated ?? Date.now()).toISOString(),
    };
  }
}
