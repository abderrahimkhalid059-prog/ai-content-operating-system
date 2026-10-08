import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AiGenerationApplyResult,
  AiGenerationCandidateSummary,
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
import { ArticleGenerationService } from './article-generation.service';
import { GenerateArticleDraftDto } from './dto/ai-generation.dto';

@ApiTags('controlled article generation')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard, PermissionGuard)
@Controller({
  path: 'workspaces/:workspaceId/websites/:websiteId/contents/:contentId/ai-generations',
  version: '1',
})
export class ArticleGenerationController {
  constructor(private readonly generation: ArticleGenerationService) {}

  @Post()
  @RequirePermissions('contents.ai.generate')
  @ApiOperation({ summary: 'Générer un aperçu éditorial IA sans créer de version' })
  generate(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() input: GenerateArticleDraftDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AiGenerationCandidateSummary> {
    return this.generation.generate(actor, workspace, websiteId, contentId, input, request);
  }

  @Post(':candidateId/apply')
  @RequirePermissions('contents.ai.apply')
  @ApiOperation({ summary: 'Appliquer une fois un aperçu IA comme nouvelle version interne' })
  apply(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<AiGenerationApplyResult> {
    return this.generation.apply(actor, workspace, websiteId, contentId, candidateId, request);
  }

  @Post(':candidateId/discard')
  @RequirePermissions('contents.ai.generate')
  @ApiOperation({ summary: 'Ignorer un aperçu IA sans modifier le contenu' })
  discard(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<AiGenerationCandidateSummary> {
    return this.generation.discard(actor, workspace, websiteId, contentId, candidateId, request);
  }
}
