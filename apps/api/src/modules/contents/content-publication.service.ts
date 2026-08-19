import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { ContentPublicationSummary, ProviderPost } from '@ai-content-os/contracts';
import {
  ContentEditorialStatus,
  ContentPublicationBindingStatus,
  ContentPublicationStatus,
  DatabaseService,
  ExternalPostStatus,
  Prisma,
  ProviderPublicationOperation,
  ProviderPublicationStatus,
  PublishingProviderType,
  WebsiteConnectionStatus,
  type ContentItem,
  type ContentPublication,
  type ProviderPublication,
} from '@ai-content-os/database';
import { ProviderError } from '@ai-content-os/integrations';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { BloggerConnectionsService } from '../integrations/blogger-connections.service';
import { BloggerProviderFactory } from '../integrations/blogger-provider.factory';
import { ContentsService } from './contents.service';
import type { ContentPublicationActionDto } from './dto/review.dto';

type SelectedConnection = Awaited<
  ReturnType<BloggerConnectionsService['requireSelectedConnection']>
>;

@Injectable()
export class ContentPublicationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly contents: ContentsService,
    private readonly connections: BloggerConnectionsService,
    private readonly providers: BloggerProviderFactory,
    private readonly audit: AuditService,
  ) {}

  async state(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    request: AuthenticatedRequest,
  ): Promise<ContentPublicationSummary> {
    const item = await this.requireItem(workspace.id, websiteId, contentId);
    const connection = await this.connections.selectedConnectionOrNull(workspace.id, websiteId);
    const binding = await this.findBinding(
      workspace.id,
      websiteId,
      contentId,
      connection?.externalSiteId,
    );
    if (!connection) return this.present(item, binding, undefined);
    if (
      !binding ||
      binding.status === ContentPublicationBindingStatus.PENDING ||
      binding.status === ContentPublicationBindingStatus.MISSING ||
      !binding.externalPostId
    ) {
      return this.present(item, binding, connection);
    }
    if (binding.externalSiteId !== connection.externalSiteId) {
      return this.present(item, binding, connection, ERROR_CODES.contentPublicationConflict);
    }
    try {
      const post = await this.providers
        .forMode(connection.mode === 'MOCK' ? 'MOCK' : 'LIVE')
        .getPost(
          this.connections.context(connection, request.requestId),
          binding.externalSiteId,
          binding.externalPostId,
        );
      if (post.status !== 'DRAFT') {
        const updated = await this.markError(
          binding,
          ERROR_CODES.contentPublicationConflict,
          ContentPublicationBindingStatus.ERROR,
        );
        return this.present(item, updated, connection);
      }
      await this.snapshot(connection, post);
      if (binding.connectionId !== connection.id || binding.lastErrorCode) {
        const recovered = await this.database.contentPublication.update({
          where: { id: binding.id },
          data: {
            connectionId: connection.id,
            status: ContentPublicationBindingStatus.ACTIVE,
            lastErrorCode: null,
            missingConfirmedAt: null,
          },
        });
        return this.present(item, recovered, connection);
      }
      return this.present(item, binding, connection);
    } catch (error) {
      if (this.isConfirmedMissing(error)) {
        const missing = await this.markError(
          binding,
          ERROR_CODES.contentPublicationMissing,
          ContentPublicationBindingStatus.MISSING,
        );
        await this.database.contentItem.updateMany({
          where: { id: contentId, workspaceId: workspace.id, websiteId },
          data: { publicationStatus: ContentPublicationStatus.FAILED },
        });
        await this.auditFailure(
          actor,
          workspace.id,
          websiteId,
          contentId,
          binding.id,
          error,
          request,
        );
        return this.present(item, missing, connection);
      }
      await this.connections.recordProviderError(connection.id, error);
      const failed = await this.markError(
        binding,
        this.safeCode(error),
        ContentPublicationBindingStatus.ERROR,
      );
      await this.auditFailure(
        actor,
        workspace.id,
        websiteId,
        contentId,
        binding.id,
        error,
        request,
      );
      const status = this.reauthorizationRequired(error)
        ? WebsiteConnectionStatus.EXPIRED
        : connection.status;
      return this.present(item, failed, { ...connection, status });
    }
  }

  createDraft(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    input: ContentPublicationActionDto,
    request: AuthenticatedRequest,
  ): Promise<ContentPublicationSummary> {
    return this.synchronize('CREATE', actor, workspace, websiteId, contentId, input, request);
  }

  updateDraft(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    input: ContentPublicationActionDto,
    request: AuthenticatedRequest,
  ): Promise<ContentPublicationSummary> {
    return this.synchronize('UPDATE', actor, workspace, websiteId, contentId, input, request);
  }

  private async synchronize(
    kind: 'CREATE' | 'UPDATE',
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    input: ContentPublicationActionDto,
    request: AuthenticatedRequest,
  ): Promise<ContentPublicationSummary> {
    const item = await this.requireItem(workspace.id, websiteId, contentId);
    if (
      item.editorialStatus !== ContentEditorialStatus.READY_TO_PUBLISH ||
      item.archivedAt ||
      item.version !== input.expectedRevision
    ) {
      throw new CodedHttpException(
        item.version !== input.expectedRevision ? HttpStatus.CONFLICT : HttpStatus.CONFLICT,
        item.version !== input.expectedRevision
          ? ERROR_CODES.contentStaleUpdate
          : ERROR_CODES.contentPublicationNotReady,
        item.version !== input.expectedRevision
          ? 'Le contenu a changé. Rechargez la dernière version avant la synchronisation.'
          : 'Seul un contenu prêt à publier peut être envoyé comme brouillon Blogger.',
      );
    }
    const connection = await this.connections.requireSelectedConnection(workspace.id, websiteId);
    if (connection.status !== WebsiteConnectionStatus.CONNECTED) {
      throw new CodedHttpException(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.integrationConnectionExpired,
        'Reconnectez Blogger avant de synchroniser ce contenu.',
      );
    }
    const payload = this.payload(item);
    const requestHash = this.hash({ kind, revision: item.version, ...payload });
    let binding = await this.findBinding(
      workspace.id,
      websiteId,
      contentId,
      connection.externalSiteId,
    );

    if (kind === 'CREATE') {
      if (binding?.externalPostId) {
        const operation = await this.findOperation(binding.id, input.idempotencyKey);
        if (operation && operation.requestHash !== requestHash) this.idempotencyConflict();
        if (binding.lastSynchronizedRevisionNumber === item.version) {
          return this.present(item, binding, connection);
        }
        throw new CodedHttpException(
          HttpStatus.CONFLICT,
          ERROR_CODES.contentPublicationConflict,
          'Un brouillon Blogger est déjà lié. Utilisez sa mise à jour explicite.',
        );
      }
      if (!binding) {
        const reservation = await this.reserveBinding(item, connection);
        binding = reservation.binding;
        if (!reservation.created) {
          if (
            binding.status === ContentPublicationBindingStatus.ACTIVE &&
            binding.externalPostId &&
            binding.lastSynchronizedRevisionNumber === item.version
          ) {
            return this.present(item, binding, connection);
          }
          if (binding.status === ContentPublicationBindingStatus.PENDING) {
            throw new CodedHttpException(
              HttpStatus.CONFLICT,
              ERROR_CODES.bloggerDuplicateOperation,
              'La création de ce brouillon est déjà en cours.',
            );
          }
        }
      } else if (binding.status === ContentPublicationBindingStatus.PENDING) {
        throw new CodedHttpException(
          HttpStatus.CONFLICT,
          ERROR_CODES.bloggerDuplicateOperation,
          'La création de ce brouillon est déjà en cours.',
        );
      }
    } else {
      if (!binding?.externalPostId || binding.status === ContentPublicationBindingStatus.MISSING) {
        throw new CodedHttpException(
          HttpStatus.CONFLICT,
          ERROR_CODES.contentPublicationMissing,
          'Aucun brouillon Blogger actif ne peut être mis à jour.',
        );
      }
      if (binding.externalSiteId !== connection.externalSiteId) {
        throw new CodedHttpException(
          HttpStatus.CONFLICT,
          ERROR_CODES.contentPublicationConflict,
          'Le brouillon appartient à une autre publication Blogger sélectionnée.',
        );
      }
      if (binding.lastSynchronizedRevisionNumber === item.version)
        return this.present(item, binding, connection);
    }

    const operationType =
      kind === 'CREATE'
        ? ProviderPublicationOperation.CREATE_DRAFT
        : ProviderPublicationOperation.UPDATE_POST;
    const reserved = await this.reserveOperation(
      binding,
      connection,
      input.idempotencyKey,
      operationType,
      requestHash,
    );
    if (reserved.existing) {
      if (reserved.publication.requestHash !== requestHash) this.idempotencyConflict();
      if (reserved.publication.status === ProviderPublicationStatus.COMPLETED) {
        const current = await this.database.contentPublication.findUniqueOrThrow({
          where: { id: binding.id },
        });
        return this.present(item, current, connection);
      }
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.bloggerDuplicateOperation,
        reserved.publication.status === ProviderPublicationStatus.PENDING
          ? 'Cette synchronisation est déjà en cours.'
          : 'Cette tentative a échoué. Utilisez une nouvelle action explicite après vérification.',
      );
    }

    try {
      const provider = this.providers.forMode(connection.mode === 'MOCK' ? 'MOCK' : 'LIVE');
      const mutation =
        kind === 'CREATE'
          ? await provider.createDraft(this.connections.context(connection, request.requestId), {
              externalSiteId: connection.externalSiteId!,
              ...payload,
              idempotencyKey: input.idempotencyKey,
            })
          : await provider.updatePost(this.connections.context(connection, request.requestId), {
              externalSiteId: connection.externalSiteId!,
              externalPostId: binding.externalPostId!,
              ...payload,
              idempotencyKey: input.idempotencyKey,
            });
      const post = mutation.post;
      if (post.status !== 'DRAFT') {
        throw new CodedHttpException(
          HttpStatus.BAD_GATEWAY,
          ERROR_CODES.contentPublicationConflict,
          'Blogger n’a pas confirmé un brouillon non publié.',
        );
      }
      await this.snapshot(connection, post);
      const synchronized = await this.database.$transaction(async (transaction) => {
        const updatedBinding = await transaction.contentPublication.update({
          where: { id: binding.id },
          data: {
            connectionId: connection.id,
            externalPostId: post.id,
            status: ContentPublicationBindingStatus.ACTIVE,
            lastSynchronizedRevisionNumber: item.version,
            lastSynchronizedHash: this.hash(payload),
            lastErrorCode: null,
            missingConfirmedAt: null,
          },
        });
        await transaction.providerPublication.update({
          where: { id: reserved.publication.id },
          data: {
            status: ProviderPublicationStatus.COMPLETED,
            externalPostId: post.id,
            completedAt: new Date(),
            lastAttemptAt: new Date(),
            attemptCount: { increment: 1 },
            safeErrorCode: null,
          },
        });
        await transaction.contentItem.updateMany({
          where: { id: contentId, workspaceId: workspace.id, websiteId, version: item.version },
          data: { publicationStatus: ContentPublicationStatus.DRAFT_SENT },
        });
        return updatedBinding;
      });
      await this.audit.record(
        {
          action:
            kind === 'CREATE' ? 'content.blogger_draft.created' : 'content.blogger_draft.updated',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'ContentPublication',
          targetId: synchronized.id,
          metadata: {
            contentId,
            revisionNumber: item.version,
            provider: 'BLOGGER',
            connectionId: connection.id,
            associationId: synchronized.id,
            operationResult: 'COMPLETED',
          },
        },
        request,
      );
      return this.present(
        { ...item, publicationStatus: ContentPublicationStatus.DRAFT_SENT },
        synchronized,
        connection,
      );
    } catch (error) {
      await this.database.$transaction([
        this.database.providerPublication.update({
          where: { id: reserved.publication.id },
          data: {
            status: ProviderPublicationStatus.FAILED,
            safeErrorCode: this.safeCode(error),
            lastAttemptAt: new Date(),
            attemptCount: { increment: 1 },
          },
        }),
        this.database.contentPublication.update({
          where: { id: binding.id },
          data: {
            status: ContentPublicationBindingStatus.ERROR,
            lastErrorCode: this.safeCode(error),
          },
        }),
        this.database.contentItem.updateMany({
          where: { id: contentId, workspaceId: workspace.id, websiteId },
          data: { publicationStatus: ContentPublicationStatus.FAILED },
        }),
      ]);
      await this.connections.recordProviderError(connection.id, error);
      await this.auditFailure(
        actor,
        workspace.id,
        websiteId,
        contentId,
        binding.id,
        error,
        request,
      );
      if (error instanceof CodedHttpException) throw error;
      throw this.connections.providerError(error);
    }
  }

  private async reserveBinding(
    item: ContentItem,
    connection: SelectedConnection,
  ): Promise<{ binding: ContentPublication; created: boolean }> {
    try {
      const binding = await this.database.contentPublication.create({
        data: {
          workspaceId: item.workspaceId,
          websiteId: item.websiteId,
          contentItemId: item.id,
          connectionId: connection.id,
          provider: PublishingProviderType.BLOGGER,
          externalSiteId: connection.externalSiteId!,
        },
      });
      return { binding, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findBinding(
          item.workspaceId,
          item.websiteId,
          item.id,
          connection.externalSiteId,
        );
        if (existing) return { binding: existing, created: false };
      }
      throw error;
    }
  }

  private async reserveOperation(
    binding: ContentPublication,
    connection: SelectedConnection,
    idempotencyKey: string,
    operationType: ProviderPublicationOperation,
    requestHash: string,
  ): Promise<{ publication: ProviderPublication; existing: boolean }> {
    const existing = await this.findOperation(binding.id, idempotencyKey);
    if (existing) return { publication: existing, existing: true };
    try {
      const publication = await this.database.providerPublication.create({
        data: {
          workspaceId: binding.workspaceId,
          websiteId: binding.websiteId,
          connectionId: connection.id,
          contentPublicationId: binding.id,
          provider: PublishingProviderType.BLOGGER,
          idempotencyKey,
          operationType,
          requestHash,
        },
      });
      return { publication, existing: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.findOperation(binding.id, idempotencyKey);
        if (raced) return { publication: raced, existing: true };
        this.idempotencyConflict();
      }
      throw error;
    }
  }

  private findOperation(contentPublicationId: string, idempotencyKey: string) {
    return this.database.providerPublication.findFirst({
      where: { contentPublicationId, idempotencyKey },
    });
  }

  private async requireItem(workspaceId: string, websiteId: string, contentId: string) {
    await this.contents.get(workspaceId, websiteId, contentId);
    return this.database.contentItem.findFirstOrThrow({
      where: { id: contentId, workspaceId, websiteId },
    });
  }

  private findBinding(
    workspaceId: string,
    websiteId: string,
    contentItemId: string,
    externalSiteId?: string | null,
  ) {
    return this.database.contentPublication.findFirst({
      where: {
        workspaceId,
        websiteId,
        contentItemId,
        provider: PublishingProviderType.BLOGGER,
        ...(externalSiteId ? { externalSiteId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private payload(item: ContentItem) {
    return {
      title: item.title,
      htmlContent: item.htmlContent,
      labels: Array.isArray(item.labels)
        ? item.labels.filter((label): label is string => typeof label === 'string')
        : [],
    };
  }

  private present(
    item: ContentItem,
    binding?: ContentPublication | null,
    connection?: Pick<SelectedConnection, 'status' | 'externalSiteName'>,
    forcedError?: string,
  ): ContentPublicationSummary {
    const lastErrorCode = forcedError ?? binding?.lastErrorCode;
    const synchronization = !connection
      ? 'NOT_CONNECTED'
      : !binding
        ? 'NOT_CONNECTED'
        : binding.status === ContentPublicationBindingStatus.MISSING
          ? 'MISSING'
          : binding.status === ContentPublicationBindingStatus.ERROR || forcedError
            ? 'ERROR'
            : !binding.externalPostId
              ? 'DRAFT_CREATED'
              : binding.lastSynchronizedRevisionNumber === item.version
                ? 'SYNCHRONIZED'
                : 'OUT_OF_SYNC';
    return {
      contentItemId: item.id,
      provider: 'BLOGGER',
      ...(connection ? { connectionStatus: connection.status } : {}),
      ...(connection?.externalSiteName ? { externalSiteName: connection.externalSiteName } : {}),
      ...(binding ? { associationId: binding.id, bindingStatus: binding.status } : {}),
      externalDraftExists: Boolean(
        binding?.externalPostId && binding.status === ContentPublicationBindingStatus.ACTIVE,
      ),
      ...(binding?.lastSynchronizedRevisionNumber
        ? { synchronizedRevisionNumber: binding.lastSynchronizedRevisionNumber }
        : {}),
      currentRevisionNumber: item.version,
      synchronization,
      ...(lastErrorCode ? { lastErrorCode } : {}),
      publicPublishEnabled: false,
      deleteEnabled: false,
      ...(binding ? { updatedAt: binding.updatedAt.toISOString() } : {}),
    };
  }

  private async snapshot(connection: SelectedConnection, post: ProviderPost): Promise<void> {
    const status =
      post.status === 'DRAFT'
        ? ExternalPostStatus.DRAFT
        : post.status === 'SCHEDULED'
          ? ExternalPostStatus.SCHEDULED
          : post.status === 'DELETED'
            ? ExternalPostStatus.DELETED
            : ExternalPostStatus.PUBLISHED;
    await this.database.externalPost.upsert({
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
        rawMetadata: { source: 'content-publication' },
      },
    });
  }

  private markError(
    binding: ContentPublication,
    code: string,
    status: ContentPublicationBindingStatus,
  ) {
    return this.database.contentPublication.update({
      where: { id: binding.id },
      data: {
        status,
        lastErrorCode: code,
        ...(status === ContentPublicationBindingStatus.MISSING
          ? { missingConfirmedAt: new Date() }
          : {}),
      },
    });
  }

  private async auditFailure(
    actor: AuthContext,
    workspaceId: string,
    websiteId: string,
    contentId: string,
    associationId: string,
    error: unknown,
    request: AuthenticatedRequest,
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'content.publication.sync_failed',
        actorUserId: actor.userId,
        workspaceId,
        websiteId,
        targetType: 'ContentPublication',
        targetId: associationId,
        metadata: {
          contentId,
          associationId,
          provider: 'BLOGGER',
          operationResult: 'FAILED',
          errorCode: this.safeCode(error),
        },
      },
      request,
    );
  }

  private isConfirmedMissing(error: unknown): boolean {
    return error instanceof ProviderError && error.code === ERROR_CODES.bloggerPostNotFound;
  }

  private reauthorizationRequired(error: unknown): boolean {
    return (
      error instanceof ProviderError &&
      (error.code === ERROR_CODES.integrationConnectionExpired ||
        error.code === ERROR_CODES.bloggerAccountUnauthorized ||
        error.code === ERROR_CODES.bloggerTokenRefreshFailed)
    );
  }

  private safeCode(error: unknown): string {
    if (error instanceof ProviderError) return error.code;
    if (error instanceof CodedHttpException) {
      const response = error.getResponse();
      if (
        response &&
        typeof response === 'object' &&
        'code' in response &&
        typeof response.code === 'string'
      ) {
        return response.code;
      }
    }
    return ERROR_CODES.bloggerUpstreamUnavailable;
  }

  private idempotencyConflict(): never {
    throw new CodedHttpException(
      HttpStatus.CONFLICT,
      ERROR_CODES.bloggerDuplicateOperation,
      'Cette clé d’idempotence correspond à une autre synchronisation.',
    );
  }

  private hash(value: unknown): string {
    return createHash('sha256')
      .update(typeof value === 'string' ? value : JSON.stringify(value))
      .digest('hex');
  }
}
