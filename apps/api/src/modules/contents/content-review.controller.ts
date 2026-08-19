import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ContentCommentSummary,
  ContentPublicationSummary,
  ContentReviewSummary,
  ReviewCenterResponse,
} from '@ai-content-os/contracts';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { PermissionGuard } from '../../common/auth/permission.guard';
import { WorkspaceGuard } from '../../common/auth/workspace.guard';
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { ContentPublicationService } from './content-publication.service';
import { ContentReviewService } from './content-review.service';
import {
  ContentPublicationActionDto,
  CreateContentCommentDto,
  CreateContentReviewDto,
  ReviewCenterQueryDto,
} from './dto/review.dto';

@ApiTags('review-center')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard, PermissionGuard)
@Controller({ path: 'workspaces/:workspaceId/websites/:websiteId/review-center', version: '1' })
export class ReviewCenterController {
  constructor(private readonly reviews: ContentReviewService) {}

  @Get()
  @RequirePermissions('contents.read')
  @ApiOperation({ summary: 'Lister les files éditoriales du Centre de révision' })
  list(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Query() query: ReviewCenterQueryDto,
  ): Promise<ReviewCenterResponse> {
    return this.reviews.reviewCenter(workspace.id, websiteId, query);
  }
}

@ApiTags('content-review')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard, PermissionGuard)
@Controller({ path: 'workspaces/:workspaceId/websites/:websiteId/contents', version: '1' })
export class ContentReviewController {
  constructor(
    private readonly reviews: ContentReviewService,
    private readonly publications: ContentPublicationService,
  ) {}

  @Get(':contentId/comments')
  @RequirePermissions('contents.comments.read')
  listComments(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ): Promise<ContentCommentSummary[]> {
    return this.reviews.listComments(workspace.id, websiteId, contentId);
  }

  @Post(':contentId/comments')
  @RequirePermissions('contents.comments.create')
  createComment(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() input: CreateContentCommentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentCommentSummary> {
    return this.reviews.createComment(actor, workspace, websiteId, contentId, input, request);
  }

  @Post(':contentId/comments/:commentId/resolve')
  @RequirePermissions('contents.comments.resolve')
  resolveComment(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentCommentSummary> {
    return this.reviews.resolveComment(actor, workspace, websiteId, contentId, commentId, request);
  }

  @Post(':contentId/comments/:commentId/reopen')
  @RequirePermissions('contents.comments.resolve')
  reopenComment(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentCommentSummary> {
    return this.reviews.reopenComment(actor, workspace, websiteId, contentId, commentId, request);
  }

  @Get(':contentId/reviews')
  @RequirePermissions('contents.reviews.read')
  listReviews(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ): Promise<ContentReviewSummary[]> {
    return this.reviews.listReviews(workspace.id, websiteId, contentId);
  }

  @Post(':contentId/reviews')
  @RequirePermissions('contents.reviews.read')
  decide(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() input: CreateContentReviewDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentReviewSummary> {
    return this.reviews.decide(actor, workspace, websiteId, contentId, input, request);
  }

  @Get(':contentId/publication')
  @RequirePermissions('contents.publication.read')
  publication(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentPublicationSummary> {
    return this.publications.state(actor, workspace, websiteId, contentId, request);
  }

  @Post(':contentId/publication/blogger/draft')
  @RequirePermissions('contents.publication.createDraft')
  createDraft(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() input: ContentPublicationActionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentPublicationSummary> {
    return this.publications.createDraft(actor, workspace, websiteId, contentId, input, request);
  }

  @Patch(':contentId/publication/blogger/draft')
  @RequirePermissions('contents.publication.updateDraft')
  updateDraft(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() input: ContentPublicationActionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentPublicationSummary> {
    return this.publications.updateDraft(actor, workspace, websiteId, contentId, input, request);
  }
}
