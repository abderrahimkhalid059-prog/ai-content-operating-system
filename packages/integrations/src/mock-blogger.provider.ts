import type {
  AuthorizationCallbackRequest,
  AuthorizationCallbackResult,
  AuthorizationRequest,
  AuthorizationUrlResult,
  ConnectionTestResult,
  CreateProviderDraftInput,
  DeleteProviderPostInput,
  ProviderConnectionContext,
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

export const MOCK_BLOGGER_ACCOUNT = {
  id: 'mock-google-account-001',
  email: 'mock.blogger@example.test',
} as const;

export const MOCK_BLOGGER_SITES: ProviderSite[] = [
  {
    id: 'mock-blog-sports-001',
    name: 'مدونة رياضية تجريبية',
    url: 'https://sports-mock.example.test',
    language: 'ar',
    description: 'Fixture Blogger رياضي للاختبار فقط.',
  },
  {
    id: 'mock-blog-tourism-001',
    name: 'Morocco Travel Mock',
    url: 'https://tourism-mock.example.test',
    language: 'en',
    description: 'Multi-site fixture only.',
  },
];

const initialPosts: ProviderPost[] = [
  {
    id: 'mock-post-sports-published-001',
    siteId: 'mock-blog-sports-001',
    title: 'مباراة تجريبية منشورة',
    htmlContent: '<p>هذا محتوى رياضي عربي تجريبي.</p>',
    url: 'https://sports-mock.example.test/2026/fixture-published',
    status: 'PUBLISHED',
    labels: ['كرة القدم', 'المغرب'],
    publishedAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-01-11T10:00:00.000Z',
  },
  {
    id: 'mock-post-sports-draft-001',
    siteId: 'mock-blog-sports-001',
    title: 'مسودة رياضية تجريبية',
    htmlContent: '<p>مسودة آمنة وغير منشورة.</p>',
    status: 'DRAFT',
    labels: ['كرة القدم'],
    updatedAt: '2026-01-12T10:00:00.000Z',
  },
  {
    id: 'mock-post-sports-labels-001',
    siteId: 'mock-blog-sports-001',
    title: 'تجميع التصنيفات',
    htmlContent: '<p>Fixture متعدد التصنيفات.</p>',
    status: 'PUBLISHED',
    labels: ['المغرب', 'الدوري', 'كرة القدم'],
    publishedAt: '2026-01-13T10:00:00.000Z',
    updatedAt: '2026-01-13T12:00:00.000Z',
  },
  {
    id: 'mock-post-sports-page-002',
    siteId: 'mock-blog-sports-001',
    title: 'صفحة ثانية من النتائج',
    htmlContent: '<p>نتيجة لاختبار pagination.</p>',
    status: 'PUBLISHED',
    labels: ['الدوري'],
    publishedAt: '2026-01-14T10:00:00.000Z',
    updatedAt: '2026-01-14T10:30:00.000Z',
  },
  {
    id: 'mock-post-tourism-001',
    siteId: 'mock-blog-tourism-001',
    title: 'Mock travel post',
    htmlContent: '<p>Tourism fixture for multi-site validation.</p>',
    status: 'PUBLISHED',
    labels: ['Morocco', 'Travel'],
    publishedAt: '2026-02-01T09:00:00.000Z',
    updatedAt: '2026-02-01T09:00:00.000Z',
  },
];

export class MockBloggerProvider implements PublishingProvider {
  private readonly posts = new Map(initialPosts.map((post) => [post.id, structuredClone(post)]));
  private readonly mutations = new Map<string, string>();
  private sequence = 1;

  getAuthorizationUrl(input: AuthorizationRequest): Promise<AuthorizationUrlResult> {
    const url = new URL(input.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code', 'mock-authorization-code');
    return Promise.resolve({ url: url.toString() });
  }

  handleAuthorizationCallback(
    input: AuthorizationCallbackRequest,
  ): Promise<AuthorizationCallbackResult> {
    if (input.code !== 'mock-authorization-code') {
      throw new ProviderError('BLOGGER_ACCOUNT_UNAUTHORIZED', 'Mock authorization was rejected.');
    }
    return Promise.resolve({
      externalAccountId: MOCK_BLOGGER_ACCOUNT.id,
      accountEmail: MOCK_BLOGGER_ACCOUNT.email,
      grantedScopes: ['mock:blogger'],
    });
  }

  refreshConnection(connection: ProviderConnectionContext): Promise<TokenRefreshResult> {
    this.simulate(connection, 'refresh');
    return Promise.resolve({
      credentials: {
        accessToken: 'mock-refreshed-access-token',
        refreshToken: 'mock-refresh-token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ['mock:blogger'],
      },
    });
  }

  testConnection(connection: ProviderConnectionContext): Promise<ConnectionTestResult> {
    this.simulate(connection);
    return Promise.resolve({
      ok: true,
      checkedAt: new Date().toISOString(),
      externalAccountId: connection.externalAccountId ?? MOCK_BLOGGER_ACCOUNT.id,
      ...(connection.externalSiteId ? { externalSiteId: connection.externalSiteId } : {}),
    });
  }

  listSites(
    connection: ProviderConnectionContext,
    pagination: ProviderPaginationInput = {},
  ): Promise<ProviderSitePage> {
    this.simulate(connection);
    return Promise.resolve(this.page(MOCK_BLOGGER_SITES, pagination));
  }

  getSite(connection: ProviderConnectionContext, externalSiteId: string): Promise<ProviderSite> {
    this.simulate(connection);
    const site = MOCK_BLOGGER_SITES.find((item) => item.id === externalSiteId);
    if (!site) throw new ProviderError('BLOGGER_BLOG_NOT_FOUND', 'Blogger site was not found.');
    return Promise.resolve(structuredClone(site));
  }

  async listTaxonomy(
    connection: ProviderConnectionContext,
    externalSiteId: string,
  ): Promise<ProviderTaxonomyResult> {
    this.simulate(connection);
    await this.getSite(connection, externalSiteId);
    const usage = new Map<string, number>();
    for (const post of this.posts.values()) {
      if (post.siteId !== externalSiteId || post.status === 'DELETED') continue;
      for (const label of post.labels) usage.set(label, (usage.get(label) ?? 0) + 1);
    }
    return { labels: [...usage].map(([name, usageCount]) => ({ name, usageCount })) };
  }

  async listPosts(
    connection: ProviderConnectionContext,
    externalSiteId: string,
    pagination: ProviderPaginationInput = {},
  ): Promise<ProviderPostPage> {
    this.simulate(connection);
    await this.getSite(connection, externalSiteId);
    const posts = [...this.posts.values()].filter(
      (post) => post.siteId === externalSiteId && post.status !== 'DELETED',
    );
    return this.page(posts, pagination);
  }

  async getPost(
    connection: ProviderConnectionContext,
    externalSiteId: string,
    externalPostId: string,
  ): Promise<ProviderPost> {
    this.simulate(connection);
    await this.getSite(connection, externalSiteId);
    const post = this.posts.get(externalPostId);
    if (!post || post.siteId !== externalSiteId || post.status === 'DELETED') {
      throw new ProviderError('BLOGGER_POST_NOT_FOUND', 'Blogger post was not found.');
    }
    return structuredClone(post);
  }

  createDraft(
    connection: ProviderConnectionContext,
    input: CreateProviderDraftInput,
  ): Promise<ProviderPostMutationResult> {
    this.simulate(connection);
    const existingId = this.mutations.get(`create:${input.idempotencyKey}`);
    if (existingId) {
      const existing = this.posts.get(existingId);
      if (existing) return Promise.resolve({ post: structuredClone(existing), created: false });
    }
    const id = `mock-created-${String(this.sequence++).padStart(4, '0')}`;
    const post: ProviderPost = {
      id,
      siteId: input.externalSiteId,
      title: input.title,
      htmlContent: input.htmlContent,
      labels: [...input.labels],
      status: 'DRAFT',
      updatedAt: new Date().toISOString(),
    };
    this.posts.set(id, post);
    this.mutations.set(`create:${input.idempotencyKey}`, id);
    return Promise.resolve({ post: structuredClone(post), created: true });
  }

  async updatePost(
    connection: ProviderConnectionContext,
    input: UpdateProviderPostInput,
  ): Promise<ProviderPostMutationResult> {
    const current = await this.getPost(connection, input.externalSiteId, input.externalPostId);
    const updated: ProviderPost = {
      ...current,
      title: input.title,
      htmlContent: input.htmlContent,
      labels: [...input.labels],
      updatedAt: new Date().toISOString(),
    };
    this.posts.set(updated.id, updated);
    return { post: structuredClone(updated), created: false };
  }

  async publishPost(
    connection: ProviderConnectionContext,
    input: PublishProviderPostInput,
  ): Promise<ProviderPostMutationResult> {
    const current = await this.getPost(connection, input.externalSiteId, input.externalPostId);
    const published: ProviderPost = {
      ...current,
      status: 'PUBLISHED',
      publishedAt: current.publishedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.posts.set(published.id, published);
    return { post: structuredClone(published), created: false };
  }

  async deletePost(
    connection: ProviderConnectionContext,
    input: DeleteProviderPostInput,
  ): Promise<void> {
    const current = await this.getPost(connection, input.externalSiteId, input.externalPostId);
    this.posts.set(current.id, {
      ...current,
      status: 'DELETED',
      updatedAt: new Date().toISOString(),
    });
  }

  private page<T>(
    values: T[],
    pagination: ProviderPaginationInput,
  ): { items: T[]; nextPageToken?: string } {
    const offset = Number(pagination.pageToken ?? 0);
    const pageSize = Math.max(1, Math.min(pagination.pageSize ?? 2, 100));
    const items = values.slice(offset, offset + pageSize).map((value) => structuredClone(value));
    const next = offset + items.length;
    return { items, ...(next < values.length ? { nextPageToken: String(next) } : {}) };
  }

  private simulate(connection: ProviderConnectionContext, operation = 'request'): void {
    switch (connection.simulation) {
      case 'TOKEN_EXPIRED':
        throw new ProviderError('INTEGRATION_CONNECTION_EXPIRED', 'Mock access token expired.');
      case 'REFRESH_FAILURE':
        if (operation === 'refresh')
          throw new ProviderError('BLOGGER_TOKEN_REFRESH_FAILED', 'Mock token refresh failed.');
        break;
      case 'RATE_LIMIT':
        throw new ProviderError('BLOGGER_RATE_LIMITED', 'Mock rate limit reached.', true, 429);
      case 'PERMISSION_DENIED':
        throw new ProviderError('BLOGGER_PERMISSION_DENIED', 'Mock permission denied.', false, 403);
      case 'SITE_NOT_FOUND':
        throw new ProviderError('BLOGGER_BLOG_NOT_FOUND', 'Mock site not found.', false, 404);
      case 'POST_NOT_FOUND':
        throw new ProviderError('BLOGGER_POST_NOT_FOUND', 'Mock post not found.', false, 404);
      case 'UPSTREAM_UNAVAILABLE':
        throw new ProviderError(
          'BLOGGER_UPSTREAM_UNAVAILABLE',
          'Mock upstream unavailable.',
          true,
          503,
        );
    }
  }
}
