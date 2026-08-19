import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ContentItemSummary,
  ContentRevisionSummary,
  PaginationResponse,
  Permission,
} from '@ai-content-os/contracts';
import {
  ContentEditorialStatus,
  ContentProfileStatus,
  ContentPublicationStatus,
  ContentReviewDecision,
  DatabaseService,
  Prisma,
  UserStatus,
  WorkspaceRole,
  type ContentItem,
  type ContentRevision,
  type ContentReview,
} from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { WebsitesService } from '../websites/websites.service';
import {
  calculateContentMetrics,
  canTransitionEditorialStatus,
  containsExecutableHtml,
  MAX_CONTENT_HTML_BYTES,
  MAX_CONTENT_LABEL_LENGTH,
  MAX_CONTENT_LABELS,
  normalizeContentLabels,
  normalizeContentSlug,
  sanitizeEditorialHtml,
} from './content-domain';
import type {
  ArchiveContentDto,
  CreateContentDto,
  ListContentsQueryDto,
  TransitionContentDto,
  UpdateContentDto,
} from './dto/content.dto';

const writerEditableStatuses = new Set<ContentEditorialStatus>([
  ContentEditorialStatus.IDEA,
  ContentEditorialStatus.RESEARCHING,
  ContentEditorialStatus.OUTLINED,
  ContentEditorialStatus.DRAFT,
  ContentEditorialStatus.CHANGES_REQUESTED,
]);

const writerTransitions = new Set<string>([
  'IDEA:RESEARCHING',
  'IDEA:DRAFT',
  'RESEARCHING:OUTLINED',
  'RESEARCHING:DRAFT',
  'OUTLINED:DRAFT',
  'DRAFT:IN_REVIEW',
  'CHANGES_REQUESTED:DRAFT',
]);

const reviewerTransitions = new Set<string>(['IN_REVIEW:CHANGES_REQUESTED', 'IN_REVIEW:APPROVED']);

@Injectable()
export class ContentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly websites: WebsitesService,
    private readonly audit: AuditService,
  ) {}

  async list(
    workspaceId: string,
    websiteId: string,
    query: ListContentsQueryDto,
  ): Promise<PaginationResponse<ContentItemSummary>> {
    await this.websites.requireWebsite(workspaceId, websiteId);
    const search = query.search?.trim();
    const where: Prisma.ContentItemWhereInput = {
      workspaceId,
      websiteId,
      ...(query.editorialStatus ? { editorialStatus: query.editorialStatus } : {}),
      ...(query.publicationStatus ? { publicationStatus: query.publicationStatus } : {}),
      ...(query.assignedTo ? { assignedToUserId: query.assignedTo } : {}),
      ...(query.createdBy ? { createdByUserId: query.createdBy } : {}),
      ...(query.language ? { language: query.language.toLowerCase() } : {}),
      ...(query.contentProfileId ? { contentProfileId: query.contentProfileId } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              { excerpt: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...this.dateFilters(query),
    };
    const [items, total] = await this.database.$transaction([
      this.database.contentItem.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.contentItem.count({ where }),
    ]);
    return {
      data: items.map((item) => this.present(item)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async create(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    input: CreateContentDto,
    request: AuthenticatedRequest,
  ): Promise<ContentItemSummary> {
    await this.websites.requireWebsite(workspace.id, websiteId);
    if (input.assignedToUserId) this.requirePermission(workspace, 'contents.assign');
    if (
      input.editorialStatus &&
      input.editorialStatus !== ContentEditorialStatus.IDEA &&
      input.editorialStatus !== ContentEditorialStatus.DRAFT
    ) {
      this.invalidTransition('Un contenu doit être créé comme idée ou brouillon.');
    }
    await this.validateReferences(
      workspace.id,
      websiteId,
      input.contentProfileId,
      input.assignedToUserId,
    );
    const title = this.normalizedTitle(input.title);
    const slug = this.validSlug(input.slug ?? title);
    const html = this.validHtml(input.htmlContent);
    const labels = this.validLabels(input.labels ?? []);
    const metrics = calculateContentMetrics(html);
    try {
      const item = await this.database.$transaction(
        async (transaction) => {
          const created = await transaction.contentItem.create({
            data: {
              workspaceId: workspace.id,
              websiteId,
              title,
              slug,
              excerpt: this.optionalText(input.excerpt),
              htmlContent: html,
              ...metrics,
              metaTitle: this.optionalText(input.metaTitle),
              metaDescription: this.optionalText(input.metaDescription),
              canonicalUrl: this.optionalText(input.canonicalUrl),
              language: input.language.toLowerCase(),
              locale: input.locale ?? null,
              featuredImageReference: this.optionalText(input.featuredImageReference),
              labels,
              editorialStatus: input.editorialStatus ?? ContentEditorialStatus.IDEA,
              publicationStatus: ContentPublicationStatus.NOT_PUBLISHED,
              createdByUserId: actor.userId,
              assignedToUserId: input.assignedToUserId ?? null,
              contentProfileId: input.contentProfileId ?? null,
            },
          });
          await this.createRevision(transaction, created, actor.userId, input.changeReason);
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await this.auditRevisionAndChange('content.created', item, actor, request, [
        'title',
        'slug',
        'htmlContent',
      ]);
      return this.present(item);
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async get(
    workspaceId: string,
    websiteId: string,
    contentId: string,
  ): Promise<ContentItemSummary> {
    await this.websites.requireWebsite(workspaceId, websiteId);
    return this.present(await this.find(workspaceId, websiteId, contentId));
  }

  async update(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    input: UpdateContentDto,
    request: AuthenticatedRequest,
  ): Promise<ContentItemSummary> {
    const current = await this.find(workspace.id, websiteId, contentId);
    if (current.editorialStatus === ContentEditorialStatus.ARCHIVED) {
      this.invalidTransition('Un contenu archivé est en lecture seule.');
    }
    const generalFields = [
      'title',
      'excerpt',
      'htmlContent',
      'language',
      'locale',
      'featuredImageReference',
      'contentProfileId',
    ] as const;
    const seoFields = ['slug', 'metaTitle', 'metaDescription', 'canonicalUrl', 'labels'] as const;
    const changedGeneral = generalFields.filter((field) => input[field] !== undefined);
    const changedSeo = seoFields.filter((field) => input[field] !== undefined);
    const assignmentChanged = input.assignedToUserId !== undefined;
    const changedFields = [
      ...changedGeneral,
      ...changedSeo,
      ...(assignmentChanged ? ['assignedToUserId'] : []),
    ];
    if (changedFields.length === 0) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Aucun champ modifiable n’a été fourni.',
      );
    }
    if (changedGeneral.length) this.requirePermission(workspace, 'contents.update');
    if (changedSeo.length) this.requirePermission(workspace, 'contents.seo.update');
    if (assignmentChanged) this.requirePermission(workspace, 'contents.assign');
    this.assertWriterCanEdit(actor.userId, workspace, current);
    await this.validateReferences(
      workspace.id,
      websiteId,
      input.contentProfileId,
      input.assignedToUserId,
    );

    const html =
      input.htmlContent === undefined ? current.htmlContent : this.validHtml(input.htmlContent);
    const metrics = calculateContentMetrics(html);
    const data: Prisma.ContentItemUpdateManyMutationInput = {
      ...(input.title !== undefined ? { title: this.normalizedTitle(input.title) } : {}),
      ...(input.slug !== undefined ? { slug: this.validSlug(input.slug) } : {}),
      ...(input.excerpt !== undefined ? { excerpt: this.optionalText(input.excerpt) } : {}),
      ...(input.htmlContent !== undefined ? { htmlContent: html, ...metrics } : {}),
      ...(input.metaTitle !== undefined ? { metaTitle: this.optionalText(input.metaTitle) } : {}),
      ...(input.metaDescription !== undefined
        ? { metaDescription: this.optionalText(input.metaDescription) }
        : {}),
      ...(input.canonicalUrl !== undefined
        ? { canonicalUrl: this.optionalText(input.canonicalUrl) }
        : {}),
      ...(input.language !== undefined ? { language: input.language.toLowerCase() } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.featuredImageReference !== undefined
        ? { featuredImageReference: this.optionalText(input.featuredImageReference) }
        : {}),
      ...(input.labels !== undefined ? { labels: this.validLabels(input.labels) } : {}),
      ...(input.contentProfileId !== undefined ? { contentProfileId: input.contentProfileId } : {}),
      ...(input.assignedToUserId !== undefined ? { assignedToUserId: input.assignedToUserId } : {}),
      version: { increment: 1 },
    };

    try {
      const updated = await this.updateWithRevision(
        workspace.id,
        websiteId,
        contentId,
        input.expectedVersion,
        data,
        actor.userId,
        input.changeReason,
      );
      await this.auditRevisionAndChange('content.updated', updated, actor, request, changedFields);
      if (assignmentChanged) {
        await this.audit.record(
          {
            action: 'content.assigned',
            actorUserId: actor.userId,
            workspaceId: workspace.id,
            websiteId,
            targetType: 'ContentItem',
            targetId: contentId,
            metadata: {
              assigneeId: input.assignedToUserId ?? null,
              revisionNumber: updated.version,
            },
          },
          request,
        );
      }
      if (changedSeo.length) {
        await this.audit.record(
          {
            action: 'content.seo_updated',
            actorUserId: actor.userId,
            workspaceId: workspace.id,
            websiteId,
            targetType: 'ContentItem',
            targetId: contentId,
            metadata: { changedFields: changedSeo.join(','), revisionNumber: updated.version },
          },
          request,
        );
      }
      return this.present(updated);
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async transition(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    input: TransitionContentDto,
    request: AuthenticatedRequest,
  ): Promise<ContentItemSummary> {
    const current = await this.find(workspace.id, websiteId, contentId);
    if (
      current.editorialStatus === ContentEditorialStatus.IN_REVIEW &&
      (input.nextStatus === ContentEditorialStatus.APPROVED ||
        input.nextStatus === ContentEditorialStatus.CHANGES_REQUESTED)
    ) {
      this.invalidTransition('Utilisez une décision du Centre de révision.');
    }
    if (input.nextStatus === ContentEditorialStatus.ARCHIVED) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.contentInvalidTransition,
        'Utilisez l’action d’archivage dédiée.',
      );
    }
    this.assertWriterCanEdit(actor.userId, workspace, current);
    this.assertRoleTransition(workspace, current.editorialStatus, input.nextStatus);
    if (!canTransitionEditorialStatus(current.editorialStatus, input.nextStatus)) {
      this.invalidTransition();
    }
    const updated = await this.updateWithRevision(
      workspace.id,
      websiteId,
      contentId,
      input.expectedVersion,
      { editorialStatus: input.nextStatus, version: { increment: 1 } },
      actor.userId,
      input.reason,
    );
    await this.audit.record(
      {
        action: 'content.status_changed',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentItem',
        targetId: contentId,
        metadata: {
          previousStatus: current.editorialStatus,
          nextStatus: input.nextStatus,
          revisionNumber: updated.version,
        },
      },
      request,
    );
    await this.auditRevision(updated, actor, request);
    return this.present(updated);
  }

  async decideReview(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    decision: ContentReviewDecision,
    reviewedRevisionNumber: number,
    note?: string,
  ): Promise<{ item: ContentItem; review: ContentReview }> {
    const current = await this.find(workspace.id, websiteId, contentId);
    const next =
      decision === ContentReviewDecision.APPROVED
        ? ContentEditorialStatus.APPROVED
        : ContentEditorialStatus.CHANGES_REQUESTED;
    this.assertRoleTransition(workspace, current.editorialStatus, next);
    if (!canTransitionEditorialStatus(current.editorialStatus, next)) this.invalidTransition();
    if (current.version !== reviewedRevisionNumber) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.contentReviewStale,
        'Une version plus récente existe. Relisez la dernière version avant de décider.',
      );
    }
    const normalizedNote = this.optionalText(note);
    if (decision === ContentReviewDecision.CHANGES_REQUESTED && !normalizedNote) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.contentReviewNoteRequired,
        'Une note est requise pour demander des modifications.',
      );
    }
    return this.database.$transaction(
      async (transaction) => {
        const reviewedRevision = await transaction.contentRevision.findFirst({
          where: {
            workspaceId: workspace.id,
            websiteId,
            contentItemId: contentId,
            revisionNumber: reviewedRevisionNumber,
          },
        });
        if (!reviewedRevision) this.staleReview();
        const changed = await transaction.contentItem.updateMany({
          where: {
            id: contentId,
            workspaceId: workspace.id,
            websiteId,
            version: reviewedRevisionNumber,
            editorialStatus: ContentEditorialStatus.IN_REVIEW,
          },
          data: { editorialStatus: next, version: { increment: 1 } },
        });
        if (changed.count !== 1) this.staleReview();
        const item = await transaction.contentItem.findFirstOrThrow({
          where: { id: contentId, workspaceId: workspace.id, websiteId },
        });
        const review = await transaction.contentReview.create({
          data: {
            workspaceId: workspace.id,
            websiteId,
            contentItemId: contentId,
            contentRevisionId: reviewedRevision.id,
            reviewerUserId: actor.userId,
            decision,
            note: normalizedNote,
            reviewedRevisionNumber,
          },
        });
        await this.createRevision(transaction, item, actor.userId, normalizedNote ?? undefined);
        return { item, review };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async archive(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    input: ArchiveContentDto,
    request: AuthenticatedRequest,
  ): Promise<ContentItemSummary> {
    const current = await this.find(workspace.id, websiteId, contentId);
    if (!canTransitionEditorialStatus(current.editorialStatus, ContentEditorialStatus.ARCHIVED)) {
      this.invalidTransition('Ce contenu est déjà archivé.');
    }
    const updated = await this.updateWithRevision(
      workspace.id,
      websiteId,
      contentId,
      input.expectedVersion,
      {
        editorialStatus: ContentEditorialStatus.ARCHIVED,
        archivedAt: new Date(),
        version: { increment: 1 },
      },
      actor.userId,
      input.reason,
    );
    await this.audit.record(
      {
        action: 'content.archived',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentItem',
        targetId: contentId,
        metadata: { previousStatus: current.editorialStatus, revisionNumber: updated.version },
      },
      request,
    );
    await this.auditRevision(updated, actor, request);
    return this.present(updated);
  }

  async revisions(
    workspaceId: string,
    websiteId: string,
    contentId: string,
  ): Promise<ContentRevisionSummary[]> {
    await this.find(workspaceId, websiteId, contentId);
    const revisions = await this.database.contentRevision.findMany({
      where: { workspaceId, websiteId, contentItemId: contentId },
      orderBy: { revisionNumber: 'desc' },
      take: 100,
    });
    return revisions.map((revision) => this.presentRevision(revision));
  }

  async revision(
    workspaceId: string,
    websiteId: string,
    contentId: string,
    revisionNumber: number,
  ): Promise<ContentRevisionSummary> {
    await this.find(workspaceId, websiteId, contentId);
    const revision = await this.database.contentRevision.findFirst({
      where: { workspaceId, websiteId, contentItemId: contentId, revisionNumber },
    });
    if (!revision) this.notFound('Version introuvable.');
    return this.presentRevision(revision);
  }

  presentForReview(item: ContentItem): ContentItemSummary {
    return this.present(item);
  }

  private async updateWithRevision(
    workspaceId: string,
    websiteId: string,
    contentId: string,
    expectedVersion: number,
    data: Prisma.ContentItemUpdateManyMutationInput,
    changedByUserId: string,
    changeReason?: string,
  ): Promise<ContentItem> {
    return this.database.$transaction(
      async (transaction) => {
        const changed = await transaction.contentItem.updateMany({
          where: { id: contentId, workspaceId, websiteId, version: expectedVersion },
          data,
        });
        if (changed.count !== 1) {
          const exists = await transaction.contentItem.count({
            where: { id: contentId, workspaceId, websiteId },
          });
          if (!exists) this.notFound();
          this.stale();
        }
        const updated = await transaction.contentItem.findFirstOrThrow({
          where: { id: contentId, workspaceId, websiteId },
        });
        await this.createRevision(transaction, updated, changedByUserId, changeReason);
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private createRevision(
    transaction: Prisma.TransactionClient,
    item: ContentItem,
    changedByUserId: string,
    changeReason?: string,
  ) {
    return transaction.contentRevision.create({
      data: {
        workspaceId: item.workspaceId,
        websiteId: item.websiteId,
        contentItemId: item.id,
        revisionNumber: item.version,
        title: item.title,
        slug: item.slug,
        excerpt: item.excerpt,
        htmlContent: item.htmlContent,
        plainTextContent: item.plainTextContent,
        metaTitle: item.metaTitle,
        metaDescription: item.metaDescription,
        canonicalUrl: item.canonicalUrl,
        language: item.language,
        locale: item.locale,
        featuredImageReference: item.featuredImageReference,
        labels: this.stringArray(item.labels),
        wordCount: item.wordCount,
        estimatedReadingMinutes: item.estimatedReadingMinutes,
        editorialStatus: item.editorialStatus,
        publicationStatus: item.publicationStatus,
        assignedToUserId: item.assignedToUserId,
        contentProfileId: item.contentProfileId,
        changedByUserId,
        changeReason: this.optionalText(changeReason),
      },
    });
  }

  private async validateReferences(
    workspaceId: string,
    websiteId: string,
    contentProfileId: string | null | undefined,
    assignedToUserId: string | null | undefined,
  ): Promise<void> {
    if (contentProfileId) {
      const profile = await this.database.contentProfile.findFirst({
        where: {
          id: contentProfileId,
          workspaceId,
          websiteId,
          status: ContentProfileStatus.ACTIVE,
        },
      });
      if (!profile) {
        throw new CodedHttpException(
          HttpStatus.BAD_REQUEST,
          ERROR_CODES.contentProfileInvalid,
          'Le profil éditorial doit être actif et appartenir au même site.',
        );
      }
    }
    if (assignedToUserId) {
      const member = await this.database.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: assignedToUserId, workspaceId } },
        include: { user: true },
      });
      if (!member || member.user.status !== UserStatus.ACTIVE) {
        throw new CodedHttpException(
          HttpStatus.BAD_REQUEST,
          ERROR_CODES.contentAssignmentInvalid,
          'La personne assignée doit être un membre actif du même espace.',
        );
      }
    }
  }

  private async find(
    workspaceId: string,
    websiteId: string,
    contentId: string,
  ): Promise<ContentItem> {
    const item = await this.database.contentItem.findFirst({
      where: { id: contentId, workspaceId, websiteId },
    });
    if (!item) this.notFound();
    return item;
  }

  private assertWriterCanEdit(
    actorUserId: string,
    workspace: WorkspaceContext,
    item: ContentItem,
  ): void {
    if (workspace.role !== WorkspaceRole.WRITER) return;
    if (
      !writerEditableStatuses.has(item.editorialStatus) ||
      (item.createdByUserId !== actorUserId && item.assignedToUserId !== actorUserId)
    ) {
      this.forbidden('Un rédacteur ne peut modifier que ses contenus éditables ou assignés.');
    }
  }

  private assertRoleTransition(
    workspace: WorkspaceContext,
    current: ContentEditorialStatus,
    next: ContentEditorialStatus,
  ): void {
    this.requirePermission(workspace, 'contents.transition');
    const edge = `${current}:${next}`;
    if (workspace.role === WorkspaceRole.WRITER && !writerTransitions.has(edge)) {
      this.forbidden('Cette transition n’est pas autorisée pour un rédacteur.');
    }
    if (workspace.role === WorkspaceRole.REVIEWER && !reviewerTransitions.has(edge)) {
      this.forbidden('Cette transition n’est pas autorisée pour un relecteur.');
    }
  }

  private requirePermission(workspace: WorkspaceContext, permission: Permission): void {
    if (!workspace.permissions.includes(permission)) this.forbidden();
  }

  private validHtml(value: string): string {
    if (Buffer.byteLength(value, 'utf8') > MAX_CONTENT_HTML_BYTES) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Le contenu HTML dépasse la taille maximale autorisée.',
      );
    }
    if (containsExecutableHtml(value)) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.contentHtmlUnsafe,
        'Le contenu HTML contient un élément exécutable interdit.',
      );
    }
    return sanitizeEditorialHtml(value);
  }

  private validLabels(value: string[]): string[] {
    const labels = normalizeContentLabels(value);
    if (
      labels.length > MAX_CONTENT_LABELS ||
      labels.some((label) => label.length > MAX_CONTENT_LABEL_LENGTH)
    ) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Les libellés dépassent les limites autorisées.',
      );
    }
    return labels;
  }

  private normalizedTitle(value: string): string {
    const title = value.trim().replace(/\s+/g, ' ');
    if (!title) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Le titre est obligatoire.',
      );
    }
    return title;
  }

  private validSlug(value: string): string {
    const slug = normalizeContentSlug(value);
    if (!slug || slug.length > 120) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Le slug est invalide.',
      );
    }
    return slug;
  }

  private optionalText(value: string | null | undefined): string | null {
    return value?.trim() || null;
  }

  private dateFilters(query: ListContentsQueryDto): Prisma.ContentItemWhereInput {
    return {
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
      ...(query.updatedFrom || query.updatedTo
        ? {
            updatedAt: {
              ...(query.updatedFrom ? { gte: new Date(query.updatedFrom) } : {}),
              ...(query.updatedTo ? { lte: new Date(query.updatedTo) } : {}),
            },
          }
        : {}),
    };
  }

  private async auditRevisionAndChange(
    action: string,
    item: ContentItem,
    actor: AuthContext,
    request: AuthenticatedRequest,
    changedFields: readonly string[],
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        actorUserId: actor.userId,
        workspaceId: item.workspaceId,
        websiteId: item.websiteId,
        targetType: 'ContentItem',
        targetId: item.id,
        metadata: { changedFields: changedFields.join(','), revisionNumber: item.version },
      },
      request,
    );
    await this.auditRevision(item, actor, request);
  }

  private auditRevision(
    item: ContentItem,
    actor: AuthContext,
    request: AuthenticatedRequest,
  ): Promise<void> {
    return this.audit.record(
      {
        action: 'content.revision_created',
        actorUserId: actor.userId,
        workspaceId: item.workspaceId,
        websiteId: item.websiteId,
        targetType: 'ContentItem',
        targetId: item.id,
        metadata: { revisionNumber: item.version },
      },
      request,
    );
  }

  private present(item: ContentItem): ContentItemSummary {
    return {
      id: item.id,
      workspaceId: item.workspaceId,
      websiteId: item.websiteId,
      ...(item.contentProfileId ? { contentProfileId: item.contentProfileId } : {}),
      title: item.title,
      slug: item.slug,
      ...(item.excerpt ? { excerpt: item.excerpt } : {}),
      htmlContent: item.htmlContent,
      plainTextContent: item.plainTextContent,
      ...(item.metaTitle ? { metaTitle: item.metaTitle } : {}),
      ...(item.metaDescription ? { metaDescription: item.metaDescription } : {}),
      ...(item.canonicalUrl ? { canonicalUrl: item.canonicalUrl } : {}),
      language: item.language,
      ...(item.locale ? { locale: item.locale } : {}),
      ...(item.featuredImageReference
        ? { featuredImageReference: item.featuredImageReference }
        : {}),
      labels: this.stringArray(item.labels),
      wordCount: item.wordCount,
      estimatedReadingMinutes: item.estimatedReadingMinutes,
      editorialStatus: item.editorialStatus,
      publicationStatus: item.publicationStatus,
      version: item.version,
      createdByUserId: item.createdByUserId,
      ...(item.assignedToUserId ? { assignedToUserId: item.assignedToUserId } : {}),
      ...(item.archivedAt ? { archivedAt: item.archivedAt.toISOString() } : {}),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private presentRevision(revision: ContentRevision): ContentRevisionSummary {
    return {
      id: revision.id,
      contentItemId: revision.contentItemId,
      revisionNumber: revision.revisionNumber,
      title: revision.title,
      slug: revision.slug,
      ...(revision.excerpt ? { excerpt: revision.excerpt } : {}),
      htmlContent: revision.htmlContent,
      plainTextContent: revision.plainTextContent,
      ...(revision.metaTitle ? { metaTitle: revision.metaTitle } : {}),
      ...(revision.metaDescription ? { metaDescription: revision.metaDescription } : {}),
      ...(revision.canonicalUrl ? { canonicalUrl: revision.canonicalUrl } : {}),
      language: revision.language,
      ...(revision.locale ? { locale: revision.locale } : {}),
      ...(revision.featuredImageReference
        ? { featuredImageReference: revision.featuredImageReference }
        : {}),
      labels: this.stringArray(revision.labels),
      wordCount: revision.wordCount,
      estimatedReadingMinutes: revision.estimatedReadingMinutes,
      editorialStatus: revision.editorialStatus,
      publicationStatus: revision.publicationStatus,
      ...(revision.assignedToUserId ? { assignedToUserId: revision.assignedToUserId } : {}),
      ...(revision.contentProfileId ? { contentProfileId: revision.contentProfileId } : {}),
      changedByUserId: revision.changedByUserId,
      ...(revision.changeReason ? { changeReason: revision.changeReason } : {}),
      changedAt: revision.changedAt.toISOString(),
    };
  }

  private stringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private handleWriteError(error: unknown): never {
    if (error instanceof CodedHttpException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.contentSlugConflict,
        'Ce slug existe déjà pour ce site.',
      );
    }
    throw error;
  }

  private stale(): never {
    throw new CodedHttpException(
      HttpStatus.CONFLICT,
      ERROR_CODES.contentStaleUpdate,
      'Ce contenu a été modifié depuis son chargement. Rechargez la version actuelle.',
    );
  }

  private staleReview(): never {
    throw new CodedHttpException(
      HttpStatus.CONFLICT,
      ERROR_CODES.contentReviewStale,
      'Le contenu a changé pendant la décision. Relisez la dernière version.',
    );
  }

  private invalidTransition(message = 'Cette transition éditoriale n’est pas autorisée.'): never {
    throw new CodedHttpException(
      HttpStatus.CONFLICT,
      ERROR_CODES.contentInvalidTransition,
      message,
    );
  }

  private forbidden(message = 'Vous ne disposez pas de cette autorisation éditoriale.'): never {
    throw new CodedHttpException(HttpStatus.FORBIDDEN, ERROR_CODES.workspaceAccessDenied, message);
  }

  private notFound(message = 'Contenu introuvable.'): never {
    throw new CodedHttpException(HttpStatus.NOT_FOUND, ERROR_CODES.notFound, message);
  }
}
