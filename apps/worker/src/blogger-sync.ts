import { createHash } from 'node:crypto';
import type { EnvironmentConfig } from '@ai-content-os/config';
import type {
  BloggerSyncJobData,
  BloggerSyncJobResult,
  ProviderConnectionContext,
  ProviderCredential,
  ProviderPost,
  PublishingProvider,
} from '@ai-content-os/contracts';
import {
  ExternalPostStatus,
  ExternalTaxonomyType,
  IntegrationMode,
  IntegrationSyncStatus,
  PublishingProviderType,
  WebsiteConnectionStatus,
} from '@ai-content-os/database';
import type { DatabaseService } from '@ai-content-os/database';
import {
  CredentialEncryption,
  FetchHttpTransport,
  LiveBloggerProvider,
  MockBloggerProvider,
  ProviderError,
} from '@ai-content-os/integrations';
import type { Job } from 'bullmq';

export class BloggerSyncProcessor {
  private readonly mock = new MockBloggerProvider();
  private readonly live: LiveBloggerProvider;
  private readonly encryption: CredentialEncryption;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: EnvironmentConfig,
  ) {
    this.encryption = new CredentialEncryption(
      config.INTEGRATION_ENCRYPTION_KEY,
      config.INTEGRATION_ENCRYPTION_KEY_VERSION,
    );
    this.live = new LiveBloggerProvider(
      {
        clientId: config.GOOGLE_BLOGGER_CLIENT_ID ?? '',
        clientSecret: config.GOOGLE_BLOGGER_CLIENT_SECRET ?? '',
        apiBaseUrl: config.BLOGGER_API_BASE_URL,
        authorizationUrl: config.BLOGGER_OAUTH_AUTH_URL,
        tokenUrl: config.BLOGGER_OAUTH_TOKEN_URL,
        timeoutMs: config.BLOGGER_REQUEST_TIMEOUT_MS,
      },
      new FetchHttpTransport(),
    );
  }

  async process(job: Job<BloggerSyncJobData>): Promise<BloggerSyncJobResult> {
    const run = await this.database.integrationSyncRun.findFirst({
      where: {
        id: job.data.syncRunId,
        workspaceId: job.data.workspaceId,
        websiteId: job.data.websiteId,
        connectionId: job.data.connectionId,
      },
    });
    if (!run) throw new Error('Scoped Blogger sync run not found.');
    if (run.status === IntegrationSyncStatus.COMPLETED) {
      return this.result(run.id, run.correlationId, 'COMPLETED', run);
    }
    const connection = await this.database.websiteConnection.findFirst({
      where: {
        id: job.data.connectionId,
        workspaceId: job.data.workspaceId,
        websiteId: job.data.websiteId,
        provider: PublishingProviderType.BLOGGER,
        revokedAt: null,
      },
    });
    if (!connection?.externalSiteId) {
      return this.fail(
        run.id,
        job.data,
        'INTEGRATION_NOT_CONFIGURED',
        'Connexion Blogger incomplète.',
      );
    }
    await this.database.integrationSyncRun.update({
      where: { id: run.id },
      data: { status: IntegrationSyncStatus.RUNNING, startedAt: run.startedAt ?? new Date() },
    });
    try {
      const provider = this.provider(connection.mode);
      const context = this.context(connection);
      const seen = new Set<string>();
      let pageToken: string | undefined;
      let created = 0;
      let updated = 0;
      let processed = 0;
      do {
        const page = await provider.listPosts(context, connection.externalSiteId, {
          pageSize: this.config.BLOGGER_SYNC_PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const post of page.items) {
          seen.add(post.id);
          const existed = await this.database.externalPost.findUnique({
            where: {
              connectionId_provider_externalPostId: {
                connectionId: connection.id,
                provider: PublishingProviderType.BLOGGER,
                externalPostId: post.id,
              },
            },
            select: { id: true },
          });
          await this.upsertPost(connection, post);
          if (!existed) {
            await this.database.auditLog.create({
              data: {
                action: 'blogger.post.imported',
                workspaceId: connection.workspaceId,
                websiteId: connection.websiteId,
                targetType: 'ExternalPost',
                correlationId: run.correlationId,
                metadata: { externalPostId: post.id },
              },
            });
          }
          processed += 1;
          if (existed) updated += 1;
          else created += 1;
        }
        pageToken = page.nextPageToken;
        await this.database.integrationSyncRun.update({
          where: { id: run.id },
          data: {
            cursor: pageToken ?? null,
            itemsProcessed: processed,
            itemsCreated: created,
            itemsUpdated: updated,
          },
        });
      } while (pageToken);

      const existing = await this.database.externalPost.findMany({
        where: { connectionId: connection.id, provider: PublishingProviderType.BLOGGER },
        select: { id: true, externalPostId: true },
      });
      const missing = existing
        .filter((post) => !seen.has(post.externalPostId))
        .map((post) => post.id);
      if (missing.length) {
        await this.database.externalPost.updateMany({
          where: { id: { in: missing } },
          data: { status: ExternalPostStatus.DELETED, deletedExternallyAt: new Date() },
        });
      }
      const taxonomy = await provider.listTaxonomy(context, connection.externalSiteId);
      const seenAt = new Date();
      for (const label of taxonomy.labels) {
        const normalizedName = label.name.trim().normalize('NFKC').toLocaleLowerCase('fr');
        await this.database.externalTaxonomyTerm.upsert({
          where: {
            connectionId_provider_type_normalizedName: {
              connectionId: connection.id,
              provider: PublishingProviderType.BLOGGER,
              type: ExternalTaxonomyType.LABEL,
              normalizedName,
            },
          },
          update: { name: label.name, usageCount: label.usageCount, lastSeenAt: seenAt },
          create: {
            workspaceId: connection.workspaceId,
            websiteId: connection.websiteId,
            connectionId: connection.id,
            provider: PublishingProviderType.BLOGGER,
            type: ExternalTaxonomyType.LABEL,
            name: label.name,
            normalizedName,
            usageCount: label.usageCount,
            lastSeenAt: seenAt,
          },
        });
      }
      const normalizedLabels = taxonomy.labels.map((label) =>
        label.name.trim().normalize('NFKC').toLocaleLowerCase('fr'),
      );
      await this.database.externalTaxonomyTerm.updateMany({
        where: {
          connectionId: connection.id,
          provider: PublishingProviderType.BLOGGER,
          type: ExternalTaxonomyType.LABEL,
          normalizedName: { notIn: normalizedLabels },
        },
        data: { usageCount: 0 },
      });
      const completed = await this.database.$transaction(async (tx) => {
        const finalRun = await tx.integrationSyncRun.update({
          where: { id: run.id },
          data: {
            status: IntegrationSyncStatus.COMPLETED,
            completedAt: new Date(),
            cursor: null,
            itemsProcessed: processed,
            itemsCreated: created,
            itemsUpdated: updated,
            errorCode: null,
            safeErrorMessage: null,
          },
        });
        await tx.websiteConnection.update({
          where: { id: connection.id },
          data: {
            status: WebsiteConnectionStatus.CONNECTED,
            lastSuccessfulSyncAt: new Date(),
            lastErrorCode: null,
            lastErrorAt: null,
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'blogger.sync.completed',
            workspaceId: connection.workspaceId,
            websiteId: connection.websiteId,
            targetType: 'IntegrationSyncRun',
            targetId: run.id,
            correlationId: run.correlationId,
            metadata: { processed, created, updated, deleted: missing.length },
          },
        });
        return finalRun;
      });
      return this.result(run.id, run.correlationId, 'COMPLETED', completed);
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : 'BLOGGER_UPSTREAM_UNAVAILABLE';
      const retryable = error instanceof ProviderError && error.retryable;
      const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
      if (retryable && job.attemptsMade + 1 < attempts) throw error;
      return this.fail(run.id, job.data, code, this.safeMessage(code));
    }
  }

  private async fail(
    runId: string,
    data: BloggerSyncJobData,
    code: string,
    safeErrorMessage: string,
  ): Promise<BloggerSyncJobResult> {
    const run = await this.database.$transaction(async (tx) => {
      const failed = await tx.integrationSyncRun.update({
        where: { id: runId },
        data: {
          status: IntegrationSyncStatus.FAILED,
          completedAt: new Date(),
          itemsFailed: { increment: 1 },
          errorCode: code,
          safeErrorMessage,
        },
      });
      await tx.websiteConnection.updateMany({
        where: { id: data.connectionId, workspaceId: data.workspaceId, websiteId: data.websiteId },
        data: {
          status:
            code === 'INTEGRATION_CONNECTION_EXPIRED'
              ? WebsiteConnectionStatus.EXPIRED
              : WebsiteConnectionStatus.DEGRADED,
          lastErrorCode: code,
          lastErrorAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'blogger.sync.failed',
          workspaceId: data.workspaceId,
          websiteId: data.websiteId,
          targetType: 'IntegrationSyncRun',
          targetId: runId,
          correlationId: data.correlationId,
          metadata: { code },
        },
      });
      await tx.auditLog.create({
        data: {
          action:
            code === 'INTEGRATION_CONNECTION_EXPIRED'
              ? 'blogger.connection.expired'
              : 'blogger.connection.degraded',
          workspaceId: data.workspaceId,
          websiteId: data.websiteId,
          targetType: 'WebsiteConnection',
          targetId: data.connectionId,
          correlationId: data.correlationId,
          metadata: { code },
        },
      });
      return failed;
    });
    return this.result(run.id, run.correlationId, 'FAILED', run, code);
  }

  private provider(mode: IntegrationMode): PublishingProvider {
    return mode === IntegrationMode.MOCK ? this.mock : this.live;
  }

  private context(connection: {
    id: string;
    mode: IntegrationMode;
    encryptedCredentials: string | null;
    credentialKeyVersion: string | null;
    externalAccountId: string | null;
    externalSiteId: string | null;
    metadata: unknown;
  }): ProviderConnectionContext {
    const metadata =
      connection.metadata &&
      typeof connection.metadata === 'object' &&
      !Array.isArray(connection.metadata)
        ? (connection.metadata as Record<string, unknown>)
        : {};
    let credentials: ProviderCredential | undefined;
    if (connection.mode === IntegrationMode.LIVE && connection.encryptedCredentials) {
      credentials = this.encryption.decrypt<ProviderCredential>(
        connection.encryptedCredentials,
        connection.credentialKeyVersion ?? '',
      );
    }
    const context: ProviderConnectionContext = {
      connectionId: connection.id,
      mode: connection.mode,
      ...(credentials ? { credentials } : {}),
      ...(connection.externalAccountId ? { externalAccountId: connection.externalAccountId } : {}),
      ...(connection.externalSiteId ? { externalSiteId: connection.externalSiteId } : {}),
    };
    if (typeof metadata.simulation === 'string') {
      context.simulation = metadata.simulation as NonNullable<
        ProviderConnectionContext['simulation']
      >;
    }
    return context;
  }

  private upsertPost(
    connection: {
      id: string;
      workspaceId: string;
      websiteId: string;
      externalSiteId: string | null;
    },
    post: ProviderPost,
  ) {
    const status =
      post.status === 'DRAFT'
        ? ExternalPostStatus.DRAFT
        : post.status === 'SCHEDULED'
          ? ExternalPostStatus.SCHEDULED
          : post.status === 'DELETED'
            ? ExternalPostStatus.DELETED
            : ExternalPostStatus.PUBLISHED;
    const values = {
      title: post.title,
      slugOrUrl: post.url ?? null,
      status,
      contentHash: createHash('sha256').update(post.htmlContent).digest('hex'),
      labels: post.labels,
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
      updatedExternallyAt: new Date(post.updatedAt),
      lastImportedAt: new Date(),
      deletedExternallyAt: status === ExternalPostStatus.DELETED ? new Date() : null,
    };
    return this.database.externalPost.upsert({
      where: {
        connectionId_provider_externalPostId: {
          connectionId: connection.id,
          provider: PublishingProviderType.BLOGGER,
          externalPostId: post.id,
        },
      },
      update: values,
      create: {
        workspaceId: connection.workspaceId,
        websiteId: connection.websiteId,
        connectionId: connection.id,
        provider: PublishingProviderType.BLOGGER,
        externalPostId: post.id,
        externalBlogId: connection.externalSiteId!,
        ...values,
        rawMetadata: { importedBy: 'blogger-sync-worker' },
      },
    });
  }

  private result(
    syncRunId: string,
    correlationId: string,
    status: 'COMPLETED' | 'FAILED',
    counts: {
      itemsProcessed: number;
      itemsCreated: number;
      itemsUpdated: number;
      itemsFailed: number;
    },
    errorCode?: string,
  ): BloggerSyncJobResult {
    return {
      syncRunId,
      correlationId,
      status,
      itemsProcessed: counts.itemsProcessed,
      itemsCreated: counts.itemsCreated,
      itemsUpdated: counts.itemsUpdated,
      itemsFailed: counts.itemsFailed,
      ...(errorCode ? { errorCode } : {}),
    };
  }

  private safeMessage(code: string): string {
    const messages: Record<string, string> = {
      BLOGGER_RATE_LIMITED: 'Le quota Blogger est temporairement atteint.',
      BLOGGER_PERMISSION_DENIED: 'Le compte ne dispose pas des autorisations requises.',
      BLOGGER_ACCOUNT_UNAUTHORIZED: 'Le compte Blogger doit être reconnecté.',
      INTEGRATION_CONNECTION_EXPIRED: 'La connexion Blogger a expiré.',
      BLOGGER_BLOG_NOT_FOUND: 'Le blog Blogger sélectionné est introuvable.',
    };
    return messages[code] ?? 'Blogger est temporairement indisponible.';
  }
}
