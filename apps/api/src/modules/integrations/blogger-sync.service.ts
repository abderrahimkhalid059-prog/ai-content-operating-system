import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ExternalLabelSummary,
  ExternalPostSummary,
  IntegrationSyncRunSummary,
} from '@ai-content-os/contracts';
import {
  DatabaseService,
  IntegrationSyncStatus,
  IntegrationSyncType,
  PublishingProviderType,
} from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { IntegrationQueueService } from '../../infrastructure/queue/integration-queue.service';
import { BloggerConnectionsService } from './blogger-connections.service';

@Injectable()
export class BloggerSyncService {
  constructor(
    private readonly database: DatabaseService,
    private readonly connections: BloggerConnectionsService,
    private readonly queue: IntegrationQueueService,
    private readonly audit: AuditService,
  ) {}

  async enqueue(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    request: AuthenticatedRequest,
  ): Promise<IntegrationSyncRunSummary> {
    const connection = await this.connections.requireSelectedConnection(workspace.id, websiteId);
    const active = await this.database.integrationSyncRun.findFirst({
      where: {
        connectionId: connection.id,
        status: { in: [IntegrationSyncStatus.PENDING, IntegrationSyncStatus.RUNNING] },
      },
    });
    if (active) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.bloggerSyncAlreadyRunning,
        'Une synchronisation Blogger est déjà en cours.',
      );
    }
    const correlationId = request.requestId?.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
      ? request.requestId
      : randomUUID();
    let run;
    try {
      run = await this.database.integrationSyncRun.create({
        data: {
          workspaceId: workspace.id,
          websiteId,
          connectionId: connection.id,
          type: IntegrationSyncType.FULL,
          correlationId,
        },
      });
    } catch {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.bloggerSyncAlreadyRunning,
        'Une synchronisation Blogger est déjà en cours.',
      );
    }
    const externalJobId = await this.queue.enqueueBloggerSync({
      syncRunId: run.id,
      workspaceId: workspace.id,
      websiteId,
      connectionId: connection.id,
      correlationId,
    });
    run = await this.database.integrationSyncRun.update({
      where: { id: run.id },
      data: { externalJobId },
    });
    await this.audit.record(
      {
        action: 'blogger.sync.started',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'IntegrationSyncRun',
        targetId: run.id,
      },
      request,
    );
    return this.presentRun(run);
  }

  async runs(workspaceId: string, websiteId: string): Promise<IntegrationSyncRunSummary[]> {
    const connection = await this.connections.requireConnection(workspaceId, websiteId);
    const runs = await this.database.integrationSyncRun.findMany({
      where: { workspaceId, websiteId, connectionId: connection.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return runs.map((run) => this.presentRun(run));
  }

  async posts(workspaceId: string, websiteId: string): Promise<ExternalPostSummary[]> {
    const connection = await this.connections.requireSelectedConnection(workspaceId, websiteId);
    const posts = await this.database.externalPost.findMany({
      where: { workspaceId, websiteId, connectionId: connection.id },
      orderBy: [{ updatedExternallyAt: 'desc' }, { title: 'asc' }],
    });
    return posts.map((post) => ({
      id: post.id,
      externalPostId: post.externalPostId,
      externalBlogId: post.externalBlogId,
      title: post.title,
      ...(post.slugOrUrl ? { externalUrl: post.slugOrUrl } : {}),
      status: post.status,
      labels: this.normalizeLabels(post.labels),
      ...(post.publishedAt ? { publishedAt: post.publishedAt.toISOString() } : {}),
      ...(post.updatedExternallyAt
        ? { updatedExternallyAt: post.updatedExternallyAt.toISOString() }
        : {}),
      lastImportedAt: post.lastImportedAt.toISOString(),
      ...(post.deletedExternallyAt
        ? { deletedExternallyAt: post.deletedExternallyAt.toISOString() }
        : {}),
    }));
  }

  async labels(workspaceId: string, websiteId: string): Promise<ExternalLabelSummary[]> {
    const connection = await this.connections.requireSelectedConnection(workspaceId, websiteId);
    const terms = await this.database.externalTaxonomyTerm.findMany({
      where: {
        workspaceId,
        websiteId,
        connectionId: connection.id,
        provider: PublishingProviderType.BLOGGER,
      },
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
    });
    return terms.map((term) => ({
      id: term.id,
      name: term.name,
      normalizedName: term.normalizedName,
      usageCount: term.usageCount,
      lastSeenAt: term.lastSeenAt.toISOString(),
    }));
  }

  private normalizeLabels(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private presentRun(run: {
    id: string;
    status: IntegrationSyncStatus;
    correlationId: string;
    externalJobId: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    itemsProcessed: number;
    itemsCreated: number;
    itemsUpdated: number;
    itemsFailed: number;
    errorCode: string | null;
    safeErrorMessage: string | null;
    createdAt: Date;
  }): IntegrationSyncRunSummary {
    return {
      id: run.id,
      status: run.status,
      correlationId: run.correlationId,
      ...(run.externalJobId ? { externalJobId: run.externalJobId } : {}),
      ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
      ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
      itemsProcessed: run.itemsProcessed,
      itemsCreated: run.itemsCreated,
      itemsUpdated: run.itemsUpdated,
      itemsFailed: run.itemsFailed,
      ...(run.errorCode ? { errorCode: run.errorCode } : {}),
      ...(run.safeErrorMessage ? { safeErrorMessage: run.safeErrorMessage } : {}),
      createdAt: run.createdAt.toISOString(),
    };
  }
}
