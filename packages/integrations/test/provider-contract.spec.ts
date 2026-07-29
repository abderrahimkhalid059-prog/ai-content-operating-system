import type { ProviderConnectionContext, PublishingProvider } from '@ai-content-os/contracts';
import { describe, expect, it } from 'vitest';
import {
  LiveBloggerProvider,
  type HttpRequest,
  type HttpTransport,
} from '../src/live-blogger.provider';
import { MockBloggerProvider } from '../src/mock-blogger.provider';
import { ProviderError } from '../src/errors';

const mockConnection: ProviderConnectionContext = {
  connectionId: 'mock-connection',
  mode: 'MOCK',
  externalAccountId: 'mock-google-account-001',
  externalSiteId: 'mock-blog-sports-001',
};

class ContractTransport implements HttpTransport {
  constructor(private readonly forcedStatus?: number) {}

  request<T>(input: HttpRequest): Promise<{ status: number; body: T }> {
    if (this.forcedStatus) return Promise.resolve({ status: this.forcedStatus, body: {} as T });
    const url = new URL(input.url);
    if (url.pathname.endsWith('/token')) {
      return Promise.resolve({
        status: 200,
        body: {
          access_token: 'live-access',
          refresh_token: input.body?.includes('authorization_code') ? 'live-refresh' : undefined,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'blogger',
        } as T,
      });
    }
    if (url.pathname.endsWith('/users/self/blogs')) {
      return Promise.resolve({
        status: 200,
        body: {
          kind: 'blogger#blogList',
          items: [
            {
              id: 'live-blog-1',
              name: 'Live contract blog',
              url: 'https://live.example.test',
              locale: { language: 'en' },
            },
          ],
        } as T,
      });
    }
    if (url.pathname.endsWith('/users/self')) {
      return Promise.resolve({
        status: 200,
        body: { kind: 'blogger#user', id: 'google-account' } as T,
      });
    }
    if (/\/blogs\/[^/]+$/.test(url.pathname)) {
      return Promise.resolve({
        status: 200,
        body: {
          id: 'live-blog-1',
          name: 'Live contract blog',
          url: 'https://live.example.test',
          locale: { language: 'en' },
        } as T,
      });
    }
    if (input.method === 'DELETE') return Promise.resolve({ status: 204, body: {} as T });
    if (url.pathname.endsWith('/posts') && (input.method ?? 'GET') === 'GET') {
      return Promise.resolve({
        status: 200,
        body: {
          items: [
            {
              id: 'live-post-1',
              blog: { id: 'live-blog-1' },
              title: 'Contract post',
              content: '<p>Contract</p>',
              status: 'draft',
              labels: ['Contract'],
              updated: '2026-01-01T00:00:00.000Z',
            },
          ],
        } as T,
      });
    }
    return Promise.resolve({
      status: 200,
      body: {
        id: 'live-post-1',
        blog: { id: 'live-blog-1' },
        title: 'Contract mutation',
        content: '<p>Contract mutation</p>',
        status: url.pathname.endsWith('/publish') ? 'live' : 'draft',
        labels: ['Contract'],
        updated: '2026-01-02T00:00:00.000Z',
      } as T,
    });
  }
}

const liveConfig = {
  clientId: 'contract-client',
  clientSecret: 'contract-secret',
  authorizationUrl: 'https://accounts.example.test/auth',
  tokenUrl: 'https://oauth.example.test/token',
  apiBaseUrl: 'https://blogger.example.test/v3',
  timeoutMs: 1_000,
};

function runContract(
  label: string,
  create: () => PublishingProvider,
  connection: ProviderConnectionContext,
  siteId: string,
): void {
  describe(`${label} publishing provider contract`, () => {
    it('constructs authorization URLs and maps callbacks', async () => {
      const provider = create();
      const auth = await provider.getAuthorizationUrl({
        state: 'one-time-state',
        redirectUri: 'https://app.example.test/callback',
        scopes: ['blogger'],
      });
      expect(auth.url).toContain('state=one-time-state');
      if (label === 'live') {
        const authorizationUrl = new URL(auth.url);
        expect(authorizationUrl.searchParams.get('access_type')).toBe('offline');
        expect(authorizationUrl.searchParams.get('prompt')).toBe('consent');
      }
      const callback = await provider.handleAuthorizationCallback({
        code: label === 'mock' ? 'mock-authorization-code' : 'contract-code',
        state: 'one-time-state',
        redirectUri: 'https://app.example.test/callback',
      });
      expect(callback.externalAccountId).toBeTruthy();
    });

    it('refreshes, tests, lists, and reads sites', async () => {
      const provider = create();
      expect((await provider.refreshConnection(connection)).credentials.accessToken).toBeTruthy();
      expect((await provider.testConnection(connection)).ok).toBe(true);
      const sites = await provider.listSites(connection, { pageSize: 1 });
      expect(sites.items).toHaveLength(1);
      expect((await provider.getSite(connection, siteId)).id).toBe(siteId);
    });

    it('lists posts with pagination and reads a post', async () => {
      const provider = create();
      const first = await provider.listPosts(connection, siteId, { pageSize: 1 });
      expect(first.items).toHaveLength(1);
      if (first.nextPageToken) {
        expect(
          (
            await provider.listPosts(connection, siteId, {
              pageSize: 1,
              pageToken: first.nextPageToken,
            })
          ).items,
        ).toHaveLength(1);
      }
      expect((await provider.getPost(connection, siteId, first.items[0]!.id)).id).toBe(
        first.items[0]!.id,
      );
      expect((await provider.listTaxonomy(connection, siteId)).labels.length).toBeGreaterThan(0);
    });

    it('creates, updates, publishes, and deletes a draft', async () => {
      const provider = create();
      const created = await provider.createDraft(connection, {
        externalSiteId: siteId,
        title: 'Contract draft',
        htmlContent: '<p>Draft</p>',
        labels: ['Contract'],
        idempotencyKey: 'contract-create',
      });
      expect(created.post.status).toBe('DRAFT');
      const updated = await provider.updatePost(connection, {
        externalSiteId: siteId,
        externalPostId: created.post.id,
        title: 'Updated draft',
        htmlContent: '<p>Updated</p>',
        labels: ['Updated'],
        idempotencyKey: 'contract-update',
      });
      expect(updated.post.title).toBeTruthy();
      expect(
        (
          await provider.publishPost(connection, {
            externalSiteId: siteId,
            externalPostId: created.post.id,
            idempotencyKey: 'contract-publish',
          })
        ).post.status,
      ).toBe('PUBLISHED');
      await expect(
        provider.deletePost(connection, {
          externalSiteId: siteId,
          externalPostId: created.post.id,
          idempotencyKey: 'contract-delete',
        }),
      ).resolves.toBeUndefined();
    });
  });
}

runContract('mock', () => new MockBloggerProvider(), mockConnection, 'mock-blog-sports-001');
runContract(
  'live',
  () => new LiveBloggerProvider(liveConfig, new ContractTransport()),
  {
    connectionId: 'live-connection',
    mode: 'LIVE',
    externalAccountId: 'google-account',
    externalSiteId: 'live-blog-1',
    credentials: {
      accessToken: 'live-access',
      refreshToken: 'live-refresh',
      scopes: ['blogger'],
    },
  },
  'live-blog-1',
);

describe('structured provider errors', () => {
  it.each([
    [401, 'BLOGGER_ACCOUNT_UNAUTHORIZED'],
    [403, 'BLOGGER_PERMISSION_DENIED'],
    [404, 'BLOGGER_BLOG_NOT_FOUND'],
    [429, 'BLOGGER_RATE_LIMITED'],
    [503, 'BLOGGER_UPSTREAM_UNAVAILABLE'],
  ])('maps HTTP %s safely', async (status, code) => {
    const provider = new LiveBloggerProvider(liveConfig, new ContractTransport(status));
    await expect(
      provider.listSites({
        connectionId: 'live',
        mode: 'LIVE',
        credentials: { accessToken: 'secret', scopes: [] },
      }),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    ['TOKEN_EXPIRED', 'INTEGRATION_CONNECTION_EXPIRED'],
    ['RATE_LIMIT', 'BLOGGER_RATE_LIMITED'],
    ['PERMISSION_DENIED', 'BLOGGER_PERMISSION_DENIED'],
    ['SITE_NOT_FOUND', 'BLOGGER_BLOG_NOT_FOUND'],
    ['POST_NOT_FOUND', 'BLOGGER_POST_NOT_FOUND'],
    ['UPSTREAM_UNAVAILABLE', 'BLOGGER_UPSTREAM_UNAVAILABLE'],
  ] as const)('simulates %s without production controls', async (simulation, code) => {
    const provider = new MockBloggerProvider();
    const request = async () => provider.listSites({ ...mockConnection, simulation });
    await expect(request()).rejects.toBeInstanceOf(ProviderError);
    await expect(request()).rejects.toMatchObject({ code });
  });

  it('simulates token refresh success and permanent refresh failure', async () => {
    const provider = new MockBloggerProvider();
    await expect(provider.refreshConnection(mockConnection)).resolves.toHaveProperty(
      'credentials.accessToken',
    );
    const failedRefresh = async () =>
      provider.refreshConnection({ ...mockConnection, simulation: 'REFRESH_FAILURE' });
    await expect(failedRefresh()).rejects.toMatchObject({
      code: 'BLOGGER_TOKEN_REFRESH_FAILED',
      retryable: false,
    });
  });
});

class SequenceTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly responses: Array<{ status: number; body: unknown }>) {}

  request<T>(input: HttpRequest): Promise<{ status: number; body: T }> {
    this.requests.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected provider request');
    return Promise.resolve({ status: response.status, body: response.body as T });
  }
}

const liveConnection: ProviderConnectionContext = {
  connectionId: 'connection-safe-id',
  workspaceId: 'workspace-safe-id',
  websiteId: 'website-safe-id',
  correlationId: 'request-safe-id',
  mode: 'LIVE',
  credentials: {
    accessToken: 'access-token-must-not-leak',
    refreshToken: 'refresh-token-must-not-leak',
    scopes: ['https://www.googleapis.com/auth/blogger'],
  },
};

const googleIdentity = { kind: 'blogger#user', id: 'google-account' };
const realGoogleBlogList = {
  kind: 'blogger#blogList',
  items: [
    {
      id: '123456789',
      name: 'Test Blog',
      url: 'https://example.blogspot.com/',
      published: '2020-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
    },
  ],
};

describe('Live Blogger blog discovery', () => {
  it('verifies identity, calls the exact official endpoint, ignores pagination, and maps items', async () => {
    const transport = new SequenceTransport([
      { status: 200, body: googleIdentity },
      { status: 200, body: realGoogleBlogList },
    ]);
    const diagnostics: unknown[] = [];
    const provider = new LiveBloggerProvider(
      {
        ...liveConfig,
        apiBaseUrl: 'https://www.googleapis.com/blogger/v3',
      },
      transport,
      (diagnostic) => diagnostics.push(diagnostic),
    );

    const result = await provider.listSites(liveConnection, {
      pageSize: 1,
      pageToken: 'unsupported-page-token',
    });

    expect(transport.requests.map(({ url }) => url)).toEqual([
      'https://www.googleapis.com/blogger/v3/users/self',
      'https://www.googleapis.com/blogger/v3/users/self/blogs',
    ]);
    expect(transport.requests[1]!.url).not.toContain('?');
    expect(transport.requests[1]!.headers?.authorization).toBe('Bearer access-token-must-not-leak');
    expect(result).toEqual({
      items: [
        {
          id: '123456789',
          name: 'Test Blog',
          url: 'https://example.blogspot.com/',
        },
      ],
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        operation: 'blogger.users.self',
        googleHttpStatus: 200,
        connectionId: 'connection-safe-id',
        requestId: 'request-safe-id',
      }),
      expect.objectContaining({
        operation: 'blogger.users.self.blogs',
        googleHttpStatus: 200,
        returnedBlogs: 1,
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /access-token-must-not-leak|refresh-token-must-not-leak|authorization/i,
    );
  });

  it('returns an empty list only for a valid successful empty Google response', async () => {
    const provider = new LiveBloggerProvider(
      liveConfig,
      new SequenceTransport([
        { status: 200, body: googleIdentity },
        { status: 200, body: { kind: 'blogger#blogList', items: [] } },
      ]),
    );

    await expect(provider.listSites(liveConnection)).resolves.toEqual({ items: [] });
  });

  it.each([
    [401, 'BLOGGER_ACCOUNT_UNAUTHORIZED'],
    [403, 'BLOGGER_PERMISSION_DENIED'],
  ])('does not convert Google HTTP %s into an empty list', async (status, code) => {
    const provider = new LiveBloggerProvider(
      liveConfig,
      new SequenceTransport([{ status, body: { error: { status: code } } }]),
    );

    await expect(provider.listSites(liveConnection)).rejects.toMatchObject({ code, status });
  });

  it('surfaces an API-disabled response with a safe provider error', async () => {
    const provider = new LiveBloggerProvider(
      liveConfig,
      new SequenceTransport([
        {
          status: 403,
          body: {
            error: {
              errors: [{ reason: 'accessNotConfigured' }],
              message: 'unsafe upstream detail must not be reflected',
            },
          },
        },
      ]),
    );

    await expect(provider.listSites(liveConnection)).rejects.toMatchObject({
      code: 'BLOGGER_PERMISSION_DENIED',
      message: 'The Blogger API is not enabled for this Google project.',
      reason: 'accessNotConfigured',
    });
  });

  it('surfaces a malformed successful blog-list response instead of an empty list', async () => {
    const provider = new LiveBloggerProvider(
      liveConfig,
      new SequenceTransport([
        { status: 200, body: googleIdentity },
        { status: 200, body: { items: realGoogleBlogList.items } },
      ]),
    );

    await expect(provider.listSites(liveConnection)).rejects.toMatchObject({
      code: 'BLOGGER_UPSTREAM_UNAVAILABLE',
      status: 502,
      reason: 'malformed_response',
    });
  });
});
