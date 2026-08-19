import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ContentCommentSummary,
  ContentReviewSummary,
  ReviewCenterQueue,
  ReviewCenterResponse,
} from '@ai-content-os/contracts';
import {
  ContentCommentStatus,
  ContentEditorialStatus,
  ContentReviewDecision,
  DatabaseService,
  Prisma,
  type ContentComment,
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
import { ContentsService } from './contents.service';
import type {
  CreateContentCommentDto,
  CreateContentReviewDto,
  ReviewCenterQueryDto,
} from './dto/review.dto';

const queueStatuses: Record<ReviewCenterQueue, readonly ContentEditorialStatus[]> = {
  TO_WRITE: [
    ContentEditorialStatus.IDEA,
    ContentEditorialStatus.RESEARCHING,
    ContentEditorialStatus.OUTLINED,
    ContentEditorialStatus.DRAFT,
  ],
  IN_REVIEW: [ContentEditorialStatus.IN_REVIEW],
  CHANGES_REQUESTED: [ContentEditorialStatus.CHANGES_REQUESTED],
  APPROVED: [ContentEditorialStatus.APPROVED],
  READY_TO_PUBLISH: [ContentEditorialStatus.READY_TO_PUBLISH],
};

@Injectable()
export class ContentReviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly websites: WebsitesService,
    private readonly contents: ContentsService,
    private readonly audit: AuditService,
  ) {}

  async reviewCenter(
    workspaceId: string,
    websiteId: string,
    query: ReviewCenterQueryDto,
  ): Promise<ReviewCenterResponse> {
    await this.websites.requireWebsite(workspaceId, websiteId);
    const baseWhere = this.reviewWhere(workspaceId, websiteId, query);
    const statuses = query.editorialStatus
      ? [query.editorialStatus]
      : query.queue
        ? queueStatuses[query.queue]
        : undefined;
    const where: Prisma.ContentItemWhereInput = {
      ...baseWhere,
      ...(statuses ? { editorialStatus: { in: [...statuses] } } : {}),
    };
    const countQueries = Object.entries(queueStatuses).map(([queue, values]) =>
      this.database.contentItem
        .count({ where: { ...baseWhere, editorialStatus: { in: [...values] } } })
        .then((count) => [queue, count] as const),
    );
    const [items, total, counts] = await Promise.all([
      this.database.contentItem.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.contentItem.count({ where }),
      Promise.all(countQueries),
    ]);
    return {
      data: items.map((item) => this.contents.presentForReview(item)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
      queueCounts: Object.fromEntries(counts) as Record<ReviewCenterQueue, number>,
    };
  }

  async listComments(
    workspaceId: string,
    websiteId: string,
    contentId: string,
  ): Promise<ContentCommentSummary[]> {
    await this.contents.get(workspaceId, websiteId, contentId);
    const comments = await this.database.contentComment.findMany({
      where: { workspaceId, websiteId, contentItemId: contentId },
      include: { author: { select: { displayName: true, email: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return comments.map((comment) => this.presentComment(comment, comment.author));
  }

  async createComment(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    input: CreateContentCommentDto,
    request: AuthenticatedRequest,
  ): Promise<ContentCommentSummary> {
    await this.contents.get(workspace.id, websiteId, contentId);
    const message = input.message.trim();
    if (!message) this.validation('Le commentaire ne peut pas être vide.');
    const comment = await this.database.contentComment.create({
      data: {
        workspaceId: workspace.id,
        websiteId,
        contentItemId: contentId,
        authorUserId: actor.userId,
        message,
      },
      include: { author: { select: { displayName: true, email: true } } },
    });
    await this.audit.record(
      {
        action: 'content.comment.created',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentComment',
        targetId: comment.id,
        metadata: { contentId },
      },
      request,
    );
    return this.presentComment(comment, comment.author);
  }

  resolveComment(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    commentId: string,
    request: AuthenticatedRequest,
  ): Promise<ContentCommentSummary> {
    return this.setCommentStatus(
      actor,
      workspace,
      websiteId,
      contentId,
      commentId,
      ContentCommentStatus.RESOLVED,
      request,
    );
  }

  reopenComment(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    commentId: string,
    request: AuthenticatedRequest,
  ): Promise<ContentCommentSummary> {
    return this.setCommentStatus(
      actor,
      workspace,
      websiteId,
      contentId,
      commentId,
      ContentCommentStatus.OPEN,
      request,
    );
  }

  async listReviews(
    workspaceId: string,
    websiteId: string,
    contentId: string,
  ): Promise<ContentReviewSummary[]> {
    await this.contents.get(workspaceId, websiteId, contentId);
    const reviews = await this.database.contentReview.findMany({
      where: { workspaceId, websiteId, contentItemId: contentId },
      include: { reviewer: { select: { displayName: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return reviews.map((review) => this.presentReview(review, review.reviewer));
  }

  async decide(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    input: CreateContentReviewDto,
    request: AuthenticatedRequest,
  ): Promise<ContentReviewSummary> {
    const permission =
      input.decision === ContentReviewDecision.APPROVED
        ? 'contents.reviews.approve'
        : 'contents.reviews.requestChanges';
    if (!workspace.permissions.includes(permission)) {
      throw new CodedHttpException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.workspaceAccessDenied,
        'Vous ne disposez pas de cette autorisation de révision.',
      );
    }
    const { item, review } = await this.contents.decideReview(
      actor,
      workspace,
      websiteId,
      contentId,
      input.decision,
      input.reviewedRevisionNumber,
      input.note,
    );
    await this.audit.record(
      {
        action:
          input.decision === ContentReviewDecision.APPROVED
            ? 'content.review.approved'
            : 'content.review.changes_requested',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentReview',
        targetId: review.id,
        metadata: {
          contentId,
          reviewId: review.id,
          revisionNumber: input.reviewedRevisionNumber,
          previousStatus: ContentEditorialStatus.IN_REVIEW,
          nextStatus: item.editorialStatus,
        },
      },
      request,
    );
    await this.audit.record(
      {
        action: 'content.revision_created',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentItem',
        targetId: contentId,
        metadata: { revisionNumber: item.version },
      },
      request,
    );
    const reviewer = await this.database.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { displayName: true, email: true },
    });
    return this.presentReview(review, reviewer);
  }

  private async setCommentStatus(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    commentId: string,
    status: ContentCommentStatus,
    request: AuthenticatedRequest,
  ): Promise<ContentCommentSummary> {
    await this.contents.get(workspace.id, websiteId, contentId);
    const changed = await this.database.contentComment.updateMany({
      where: { id: commentId, workspaceId: workspace.id, websiteId, contentItemId: contentId },
      data:
        status === ContentCommentStatus.RESOLVED
          ? { status, resolvedAt: new Date(), resolvedByUserId: actor.userId }
          : { status, resolvedAt: null, resolvedByUserId: null },
    });
    if (changed.count !== 1) this.notFound('Commentaire introuvable.');
    const comment = await this.database.contentComment.findFirstOrThrow({
      where: { id: commentId, workspaceId: workspace.id, websiteId, contentItemId: contentId },
      include: { author: { select: { displayName: true, email: true } } },
    });
    await this.audit.record(
      {
        action:
          status === ContentCommentStatus.RESOLVED
            ? 'content.comment.resolved'
            : 'content.comment.reopened',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentComment',
        targetId: comment.id,
        metadata: { contentId, status },
      },
      request,
    );
    return this.presentComment(comment, comment.author);
  }

  private reviewWhere(
    workspaceId: string,
    websiteId: string,
    query: ReviewCenterQueryDto,
  ): Prisma.ContentItemWhereInput {
    const search = query.search?.trim();
    return {
      workspaceId,
      websiteId,
      ...(query.language ? { language: query.language.toLowerCase() } : {}),
      ...(query.createdBy ? { createdByUserId: query.createdBy } : {}),
      ...(query.assignedTo ? { assignedToUserId: query.assignedTo } : {}),
      ...(query.contentProfileId ? { contentProfileId: query.contentProfileId } : {}),
      ...(query.updatedFrom || query.updatedTo
        ? {
            updatedAt: {
              ...(query.updatedFrom ? { gte: new Date(query.updatedFrom) } : {}),
              ...(query.updatedTo ? { lte: new Date(query.updatedTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              { excerpt: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private presentComment(
    comment: ContentComment,
    author: { displayName: string | null; email: string },
  ): ContentCommentSummary {
    return {
      id: comment.id,
      contentItemId: comment.contentItemId,
      authorUserId: comment.authorUserId,
      authorDisplayName: author.displayName ?? author.email,
      message: comment.message,
      status: comment.status,
      ...(comment.resolvedAt ? { resolvedAt: comment.resolvedAt.toISOString() } : {}),
      ...(comment.resolvedByUserId ? { resolvedByUserId: comment.resolvedByUserId } : {}),
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    };
  }

  private presentReview(
    review: ContentReview,
    reviewer: { displayName: string | null; email: string },
  ): ContentReviewSummary {
    return {
      id: review.id,
      contentItemId: review.contentItemId,
      reviewerUserId: review.reviewerUserId,
      reviewerDisplayName: reviewer.displayName ?? reviewer.email,
      decision: review.decision,
      ...(review.note ? { note: review.note } : {}),
      reviewedRevisionNumber: review.reviewedRevisionNumber,
      createdAt: review.createdAt.toISOString(),
    };
  }

  private validation(message: string): never {
    throw new CodedHttpException(HttpStatus.BAD_REQUEST, ERROR_CODES.validation, message);
  }

  private notFound(message: string): never {
    throw new CodedHttpException(HttpStatus.NOT_FOUND, ERROR_CODES.notFound, message);
  }
}
