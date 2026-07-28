import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '@ai-content-os/config';
import type {
  ExternalPostSummary,
  ProviderPost,
  PublicationOperationResult,
} from '@ai-content-os/contracts';
import {
  DatabaseService,
  ExternalPostStatus,
  Prisma,
  ProviderPublicationOperation,
  ProviderPublicationStatus,
  PublishingProviderType,
  type ProviderPublication,
} from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { BloggerConnectionsService } from './blogger-connections.service';
import { BloggerProviderFactory } from './blogger-provider.factory';
import type { CreateTestDraftDto, UpdateTestDraftDto } from './dto/blogger-integration.dto';

@Injectable()
export class BloggerPublicationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService<EnvironmentConfig, true>,
    private readonly connections: BloggerConnectionsService,
    private readonly providers: BloggerProviderFactory,
    private readonly audit: AuditService,
  ) {}

  async createDraft(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    input: CreateTestDraftDto,
    request: AuthenticatedRequest,
  ): Promise<PublicationOperationResult> {
    this.validatePayload(input);
    const connection = await this.connections.requireSelectedConnection(workspace.id, websiteId);
    const reserved = await this.reserve(
      workspace.id,
      websiteId,
      connection.id,
      input.idempotencyKey,
      ProviderPublicationOperation.CREATE_DRAFT,
      input,
    );
    if (reserved.existing) return this.existingResult(reserved.publication);
    try {
      const mutation = await this.providers
        .forMode(this.mode(connection.mode))
        .createDraft(this.connections.context(connection), {
          externalSiteId: connection.externalSiteId!,
          title: input.title.trim(),
          htmlContent: input.htmlContent,
          labels: this.normalizeLabels(input.labels),
          idempotencyKey: input.idempotencyKey,
        });
      const post = await this.snapshot(connection, mutation.post);
      const publication = await this.complete(reserved.publication.id, post.externalPostId);
      await this.audit.record(
        {
          action: 'blogger.draft.created',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'ProviderPublication',
          targetId: publication.id,
          metadata: { externalPostId: post.externalPostId },
        },
        request,
      );
      return this.result(publication, this.presentPost(post));
    } catch (error) {
      await this.fail(reserved.publication.id, error);
      throw this.connections.providerError(error);
    }
  }

  async get(
    workspaceId: string,
    websiteId: string,
    externalPostId: string,
  ): Promise<ExternalPostSummary> {
    const connection = await this.connections.requireSelectedConnection(workspaceId, websiteId);
    try {
      const providerPost = await this.providers
        .forMode(this.mode(connection.mode))
        .getPost(this.connections.context(connection), connection.externalSiteId!, externalPostId);
      return this.presentPost(await this.snapshot(connection, providerPost));
    } catch (error) {
      throw this.connections.providerError(error);
    }
  }

  async update(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    externalPostId: string,
    input: UpdateTestDraftDto,
    request: AuthenticatedRequest,
  ): Promise<PublicationOperationResult> {
    this.validatePayload(input);
    const connection = await this.connections.requireSelectedConnection(workspace.id, websiteId);
    const requestValue = { ...input, externalPostId };
    const reserved = await this.reserve(
      workspace.id,
      websiteId,
      connection.id,
      input.idempotencyKey,
      ProviderPublicationOperation.UPDATE_POST,
      requestValue,
    );
    if (reserved.existing) return this.existingResult(reserved.publication);
    try {
      const mutation = await this.providers
        .forMode(this.mode(connection.mode))
        .updatePost(this.connections.context(connection), {
          externalSiteId: connection.externalSiteId!,
          externalPostId,
          title: input.title.trim(),
          htmlContent: input.htmlContent,
          labels: this.normalizeLabels(input.labels),
          idempotencyKey: input.idempotencyKey,
        });
      const post = await this.snapshot(connection, mutation.post);
      const publication = await this.complete(reserved.publication.id, externalPostId);
      await this.audit.record(
        {
          action: 'blogger.draft.updated',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'ProviderPublication',
          targetId: publication.id,
          metadata: { externalPostId },
        },
        request,
      );
      return this.result(publication, this.presentPost(post));
    } catch (error) {
      await this.fail(reserved.publication.id, error);
      throw this.connections.providerError(error);
    }
  }

  async publish(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    externalPostId: string,
    idempotencyKey: string,
    request: AuthenticatedRequest,
  ): Promise<PublicationOperationResult> {
    if (!this.config.get('BLOGGER_ALLOW_PUBLIC_PUBLISH', { infer: true })) {
      await this.blockedAudit(
        'blogger.publication.blocked',
        ERROR_CODES.bloggerPublicPublishDisabled,
        actor,
        workspace,
        websiteId,
        request,
      );
      throw new CodedHttpException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.bloggerPublicPublishDisabled,
        'La publication publique Blogger est désactivée sur ce serveur.',
      );
    }
    return this.postAction(
      actor,
      workspace,
      websiteId,
      externalPostId,
      idempotencyKey,
      ProviderPublicationOperation.PUBLISH_POST,
      'blogger.draft.published',
      request,
    );
  }

  async delete(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    externalPostId: string,
    idempotencyKey: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    if (!this.config.get('BLOGGER_ALLOW_DELETE', { infer: true })) {
      await this.blockedAudit(
        'blogger.delete.blocked',
        ERROR_CODES.bloggerDeleteDisabled,
        actor,
        workspace,
        websiteId,
        request,
      );
      throw new CodedHttpException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.bloggerDeleteDisabled,
        'La suppression Blogger est désactivée sur ce serveur.',
      );
    }
    const connection = await this.connections.requireSelectedConnection(workspace.id, websiteId);
    const reserved = await this.reserve(
      workspace.id,
      websiteId,
      connection.id,
      idempotencyKey,
      ProviderPublicationOperation.DELETE_POST,
      { externalPostId },
    );
    if (reserved.existing && reserved.publication.status === ProviderPublicationStatus.COMPLETED)
      return;
    try {
      await this.providers
        .forMode(this.mode(connection.mode))
        .deletePost(this.connections.context(connection), {
          externalSiteId: connection.externalSiteId!,
          externalPostId,
          idempotencyKey,
        });
      await this.database.$transaction([
        this.database.externalPost.updateMany({
          where: { connectionId: connection.id, externalPostId },
          data: { status: ExternalPostStatus.DELETED, deletedExternallyAt: new Date() },
        }),
        this.database.providerPublication.update({
          where: { id: reserved.publication.id },
          data: {
            status: ProviderPublicationStatus.COMPLETED,
            externalPostId,
            completedAt: new Date(),
            lastAttemptAt: new Date(),
            attemptCount: { increment: 1 },
          },
        }),
      ]);
      await this.audit.record(
        {
          action: 'blogger.test_draft.deleted',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'ProviderPublication',
          targetId: reserved.publication.id,
          metadata: { externalPostId },
        },
        request,
      );
    } catch (error) {
      await this.fail(reserved.publication.id, error);
      throw this.connections.providerError(error);
    }
  }

  private async postAction(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    externalPostId: string,
    idempotencyKey: string,
    operation: ProviderPublicationOperation,
    auditAction: string,
    request: AuthenticatedRequest,
  ): Promise<PublicationOperationResult> {
    const connection = await this.connections.requireSelectedConnection(workspace.id, websiteId);
    const reserved = await this.reserve(
      workspace.id,
      websiteId,
      connection.id,
      idempotencyKey,
      operation,
      { externalPostId },
    );
    if (reserved.existing) return this.existingResult(reserved.publication);
    try {
      const mutation = await this.providers
        .forMode(this.mode(connection.mode))
        .publishPost(this.connections.context(connection), {
          externalSiteId: connection.externalSiteId!,
          externalPostId,
          idempotencyKey,
        });
      const post = await this.snapshot(connection, mutation.post);
      const publication = await this.complete(reserved.publication.id, externalPostId);
      await this.audit.record(
        {
          action: auditAction,
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'ProviderPublication',
          targetId: publication.id,
          metadata: { externalPostId },
        },
        request,
      );
      return this.result(publication, this.presentPost(post));
    } catch (error) {
      await this.fail(reserved.publication.id, error);
      throw this.connections.providerError(error);
    }
  }

  private async reserve(
    workspaceId: string,
    websiteId: string,
    connectionId: string,
    idempotencyKey: string,
    operationType: ProviderPublicationOperation,
    request: unknown,
  ): Promise<{ publication: ProviderPublication; existing: boolean }> {
    const requestHash = this.hash(request);
    const existing = await this.database.providerPublication.findUnique({
      where: {
        connectionId_provider_idempotencyKey: {
          connectionId,
          provider: PublishingProviderType.BLOGGER,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== requestHash || existing.operationType !== operationType) {
        await this.auditDuplicate(workspaceId, websiteId, existing.id, operationType);
        throw new CodedHttpException(
          HttpStatus.CONFLICT,
          ERROR_CODES.bloggerDuplicateOperation,
          'Cette clé d’idempotence correspond à une autre requête.',
        );
      }
      if (existing.status === ProviderPublicationStatus.PENDING) {
        await this.auditDuplicate(workspaceId, websiteId, existing.id, operationType);
        throw new CodedHttpException(
          HttpStatus.CONFLICT,
          ERROR_CODES.bloggerDuplicateOperation,
          'Cette opération identique est déjà en cours.',
        );
      }
      return { publication: existing, existing: true as const };
    }
    try {
      const publication = await this.database.providerPublication.create({
        data: {
          workspaceId,
          websiteId,
          connectionId,
          provider: PublishingProviderType.BLOGGER,
          idempotencyKey,
          operationType,
          requestHash,
        },
      });
      return { publication, existing: false as const };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.reserve(
          workspaceId,
          websiteId,
          connectionId,
          idempotencyKey,
          operationType,
          request,
        );
      }
      throw error;
    }
  }

  private async auditDuplicate(
    workspaceId: string,
    websiteId: string,
    publicationId: string,
    operationType: ProviderPublicationOperation,
  ): Promise<void> {
    await this.database.auditLog.create({
      data: {
        action: 'blogger.publication.duplicate_prevented',
        workspaceId,
        websiteId,
        targetType: 'ProviderPublication',
        targetId: publicationId,
        metadata: { operationType },
      },
    });
  }

  private async existingResult(publication: {
    id: string;
    idempotencyKey: string;
    status: ProviderPublicationStatus;
    externalPostId: string | null;
    connectionId: string;
  }): Promise<PublicationOperationResult> {
    const post = publication.externalPostId
      ? await this.database.externalPost.findFirst({
          where: {
            connectionId: publication.connectionId,
            externalPostId: publication.externalPostId,
          },
        })
      : null;
    return this.result(publication, post ? this.presentPost(post) : undefined);
  }

  private complete(publicationId: string, externalPostId: string) {
    return this.database.providerPublication.update({
      where: { id: publicationId },
      data: {
        status: ProviderPublicationStatus.COMPLETED,
        externalPostId,
        completedAt: new Date(),
        lastAttemptAt: new Date(),
        attemptCount: { increment: 1 },
        safeErrorCode: null,
      },
    });
  }

  private fail(publicationId: string, error: unknown): Promise<unknown> {
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : ERROR_CODES.internal;
    return this.database.providerPublication.update({
      where: { id: publicationId },
      data: {
        status: ProviderPublicationStatus.FAILED,
        safeErrorCode: code,
        lastAttemptAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
  }

  private snapshot(
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
    return this.database.externalPost.upsert({
      where: {
        connectionId_provider_externalPostId: {
          connectionId: connection.id,
          provider: PublishingProviderType.BLOGGER,
          externalPostId: post.id,
        },
      },
      update: {
        title: post.title,
        slugOrUrl: post.url ?? null,
        status,
        contentHash: this.hash(post.htmlContent),
        labels: post.labels,
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
        updatedExternallyAt: new Date(post.updatedAt),
        lastImportedAt: new Date(),
        deletedExternallyAt: status === ExternalPostStatus.DELETED ? new Date() : null,
      },
      create: {
        workspaceId: connection.workspaceId,
        websiteId: connection.websiteId,
        connectionId: connection.id,
        provider: PublishingProviderType.BLOGGER,
        externalPostId: post.id,
        externalBlogId: connection.externalSiteId!,
        title: post.title,
        slugOrUrl: post.url ?? null,
        status,
        contentHash: this.hash(post.htmlContent),
        labels: post.labels,
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
        updatedExternallyAt: new Date(post.updatedAt),
        lastImportedAt: new Date(),
        rawMetadata: { source: 'provider-publication' },
      },
    });
  }

  private validatePayload(input: CreateTestDraftDto): void {
    const html = input.htmlContent;
    if (
      Buffer.byteLength(html, 'utf8') > 100_000 ||
      /<\s*script\b|<\s*iframe\b|\son\w+\s*=|javascript\s*:/i.test(html)
    ) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.bloggerInvalidHtml,
        'Le HTML contient un élément interdit ou dépasse la taille autorisée.',
      );
    }
    const labels = this.normalizeLabels(input.labels);
    if (
      labels.some(
        (label) =>
          label.length > 100 || [...label].some((character) => character.charCodeAt(0) <= 31),
      )
    ) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Un libellé Blogger est invalide.',
      );
    }
  }

  private normalizeLabels(labels: string[]): string[] {
    return [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  }

  private presentPost(post: {
    id: string;
    externalPostId: string;
    externalBlogId: string;
    title: string;
    slugOrUrl: string | null;
    status: ExternalPostStatus;
    labels: unknown;
    publishedAt: Date | null;
    updatedExternallyAt: Date | null;
    lastImportedAt: Date;
    deletedExternallyAt: Date | null;
  }): ExternalPostSummary {
    return {
      id: post.id,
      externalPostId: post.externalPostId,
      externalBlogId: post.externalBlogId,
      title: post.title,
      ...(post.slugOrUrl ? { externalUrl: post.slugOrUrl } : {}),
      status: post.status,
      labels: Array.isArray(post.labels)
        ? post.labels.filter((label): label is string => typeof label === 'string')
        : [],
      ...(post.publishedAt ? { publishedAt: post.publishedAt.toISOString() } : {}),
      ...(post.updatedExternallyAt
        ? { updatedExternallyAt: post.updatedExternallyAt.toISOString() }
        : {}),
      lastImportedAt: post.lastImportedAt.toISOString(),
      ...(post.deletedExternallyAt
        ? { deletedExternallyAt: post.deletedExternallyAt.toISOString() }
        : {}),
    };
  }

  private result(
    publication: {
      id: string;
      idempotencyKey: string;
      status: ProviderPublicationStatus;
    },
    post?: ExternalPostSummary,
  ): PublicationOperationResult {
    return {
      operationId: publication.id,
      idempotencyKey: publication.idempotencyKey,
      status: publication.status,
      ...(post ? { post } : {}),
    };
  }

  private async blockedAudit(
    action: string,
    reason: string,
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'Website',
        targetId: websiteId,
        metadata: { reason },
      },
      request,
    );
  }

  private mode(mode: 'MOCK' | 'LIVE') {
    return mode;
  }

  private hash(value: unknown): string {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return createHash('sha256').update(serialized).digest('hex');
  }
}
