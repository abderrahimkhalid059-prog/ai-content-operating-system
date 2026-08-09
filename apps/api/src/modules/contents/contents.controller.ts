import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ContentItemSummary,
  ContentRevisionSummary,
  PaginationResponse,
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
import { ContentsService } from './contents.service';
import {
  ArchiveContentDto,
  CreateContentDto,
  ListContentsQueryDto,
  TransitionContentDto,
  UpdateContentDto,
} from './dto/content.dto';

@ApiTags('contents')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard, PermissionGuard)
@Controller({ path: 'workspaces/:workspaceId/websites/:websiteId/contents', version: '1' })
export class ContentsController {
  constructor(private readonly contents: ContentsService) {}

  @Get()
  @RequirePermissions('contents.read')
  @ApiOperation({ summary: 'Lister les contenus du site courant' })
  list(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Query() query: ListContentsQueryDto,
  ): Promise<PaginationResponse<ContentItemSummary>> {
    return this.contents.list(workspace.id, websiteId, query);
  }

  @Post()
  @RequirePermissions('contents.create')
  @ApiOperation({ summary: 'Créer un contenu manuel et sa première version' })
  create(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() input: CreateContentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentItemSummary> {
    return this.contents.create(actor, workspace, websiteId, input, request);
  }

  @Get(':contentId')
  @RequirePermissions('contents.read')
  @ApiOperation({ summary: 'Lire un contenu du site courant' })
  get(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ): Promise<ContentItemSummary> {
    return this.contents.get(workspace.id, websiteId, contentId);
  }

  @Patch(':contentId')
  @ApiOperation({ summary: 'Modifier un contenu avec contrôle de version optimiste' })
  update(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() input: UpdateContentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentItemSummary> {
    return this.contents.update(actor, workspace, websiteId, contentId, input, request);
  }

  @Post(':contentId/transition')
  @RequirePermissions('contents.transition')
  @ApiOperation({ summary: 'Appliquer une transition éditoriale autorisée' })
  transition(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() input: TransitionContentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentItemSummary> {
    return this.contents.transition(actor, workspace, websiteId, contentId, input, request);
  }

  @Post(':contentId/archive')
  @RequirePermissions('contents.archive')
  @ApiOperation({ summary: 'Archiver un contenu sans suppression physique' })
  archive(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() input: ArchiveContentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentItemSummary> {
    return this.contents.archive(actor, workspace, websiteId, contentId, input, request);
  }

  @Get(':contentId/revisions')
  @RequirePermissions('contents.revisions.read')
  @ApiOperation({ summary: 'Lister les versions immuables d’un contenu' })
  revisions(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ): Promise<ContentRevisionSummary[]> {
    return this.contents.revisions(workspace.id, websiteId, contentId);
  }

  @Get(':contentId/revisions/:revisionNumber')
  @RequirePermissions('contents.revisions.read')
  @ApiOperation({ summary: 'Lire une version immuable d’un contenu' })
  revision(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('revisionNumber', ParseIntPipe) revisionNumber: number,
  ): Promise<ContentRevisionSummary> {
    return this.contents.revision(workspace.id, websiteId, contentId, revisionNumber);
  }
}
