import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type {
  CurrentBloggerTestPublication,
  ExternalLabelSummary,
  ExternalPostSummary,
  IntegrationSummary,
  IntegrationSyncRunSummary,
  PublicationOperationResult,
  StartBloggerConnectionResult,
} from '@ai-content-os/contracts';
import { PermissionGuard } from '../../common/auth/permission.guard';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { WorkspaceGuard } from '../../common/auth/workspace.guard';
import {
  CurrentUser,
  CurrentWorkspace,
  Public,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { BloggerConnectionsService } from './blogger-connections.service';
import { BloggerPublicationService } from './blogger-publication.service';
import { BloggerSyncService } from './blogger-sync.service';
import {
  BloggerCallbackDto,
  CreateTestDraftDto,
  ProviderPaginationDto,
  PublicationActionDto,
  SelectBloggerSiteDto,
  StartBloggerConnectionDto,
  UpdateTestDraftDto,
} from './dto/blogger-integration.dto';

@ApiTags('integrations')
@Controller({ path: 'integrations', version: '1' })
export class PublicIntegrationsController {
  constructor(private readonly connections: BloggerConnectionsService) {}

  @Public()
  @Get('status')
  @Header('Cache-Control', 'no-store, private')
  @ApiOperation({ summary: 'Expose only safe integration feature flags' })
  status() {
    return this.connections.systemStatus();
  }

  @Public()
  @Get('blogger/callback')
  @ApiOperation({ summary: 'Consume a one-time Google OAuth state' })
  async callback(
    @Query() query: BloggerCallbackDto,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    response.redirect(
      HttpStatus.FOUND,
      await this.connections.callback(query.state, query.code, request),
    );
  }
}

@ApiTags('blogger')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard, PermissionGuard)
@Controller({ path: 'workspaces/:workspaceId/websites/:websiteId', version: '1' })
export class BloggerIntegrationsController {
  constructor(
    private readonly connections: BloggerConnectionsService,
    private readonly sync: BloggerSyncService,
    private readonly publication: BloggerPublicationService,
  ) {}

  @Get('integrations')
  @RequirePermissions('integrations.read')
  integrations(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
  ): Promise<IntegrationSummary[]> {
    return this.connections.list(workspace.id, websiteId);
  }

  @Get('integrations/blogger')
  @Header('Cache-Control', 'no-store, private')
  @RequirePermissions('integrations.read')
  integration(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
  ): Promise<IntegrationSummary> {
    return this.connections.get(workspace.id, websiteId);
  }

  @Post('integrations/blogger/connect')
  @RequirePermissions('integrations.connect')
  connect(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() input: StartBloggerConnectionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StartBloggerConnectionResult> {
    return this.connections.start(actor, workspace, websiteId, input, request);
  }

  @Get('integrations/blogger/sites')
  @Header('Cache-Control', 'no-store, private')
  @RequirePermissions('integrations.read')
  sites(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Query() query: ProviderPaginationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.sites(
      actor,
      workspace,
      websiteId,
      query.pageSize,
      query.pageToken,
      request,
    );
  }

  @Post('integrations/blogger/select-site')
  @RequirePermissions('integrations.update')
  selectSite(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() input: SelectBloggerSiteDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<IntegrationSummary> {
    return this.connections.selectSite(actor, workspace, websiteId, input.externalSiteId, request);
  }

  @Post('integrations/blogger/test')
  @RequirePermissions('integrations.test')
  test(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.test(actor, workspace, websiteId, request);
  }

  @Post('integrations/blogger/refresh')
  @RequirePermissions('integrations.update')
  refresh(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<IntegrationSummary> {
    return this.connections.refresh(actor, workspace, websiteId, request);
  }

  @Post('integrations/blogger/sync')
  @RequirePermissions('integrations.sync')
  syncPosts(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<IntegrationSyncRunSummary> {
    return this.sync.enqueue(actor, workspace, websiteId, request);
  }

  @Get('integrations/blogger/sync-runs')
  @RequirePermissions('integrations.read')
  syncRuns(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
  ): Promise<IntegrationSyncRunSummary[]> {
    return this.sync.runs(workspace.id, websiteId);
  }

  @Delete('integrations/blogger')
  @RequirePermissions('integrations.disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.connections.disconnect(actor, workspace, websiteId, request);
  }

  @Post('integrations/blogger/disconnect')
  @RequirePermissions('integrations.disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnectAction(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.connections.disconnect(actor, workspace, websiteId, request);
  }

  @Get('external-posts')
  @RequirePermissions('externalPosts.read')
  posts(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
  ): Promise<ExternalPostSummary[]> {
    return this.sync.posts(workspace.id, websiteId);
  }

  @Get('external-labels')
  @RequirePermissions('externalPosts.read')
  labels(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
  ): Promise<ExternalLabelSummary[]> {
    return this.sync.labels(workspace.id, websiteId);
  }

  @Post('integrations/blogger/test-posts')
  @RequirePermissions('providerPublishing.createDraft')
  createDraft(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() input: CreateTestDraftDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PublicationOperationResult> {
    return this.publication.createDraft(actor, workspace, websiteId, input, request);
  }

  @Get('integrations/blogger/test-publication/current')
  @Header('Cache-Control', 'no-store, private')
  @RequirePermissions('integrations.read')
  async currentTestPublication(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const current: CurrentBloggerTestPublication | null = await this.publication.current(
      actor,
      workspace,
      websiteId,
      request,
    );
    response.status(HttpStatus.OK).json(current);
  }

  @Patch('integrations/blogger/test-publication/current')
  @RequirePermissions('providerPublishing.update')
  updateCurrentTestPublication(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() input: UpdateTestDraftDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PublicationOperationResult> {
    return this.publication.update(actor, workspace, websiteId, undefined, input, request);
  }

  @Post('integrations/blogger/test-publication/current/publish')
  @RequirePermissions('providerPublishing.publish')
  publishCurrentTestPublication(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() input: PublicationActionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PublicationOperationResult> {
    return this.publication.publish(
      actor,
      workspace,
      websiteId,
      undefined,
      input.idempotencyKey,
      request,
    );
  }

  @Delete('integrations/blogger/test-publication/current')
  @RequirePermissions('providerPublishing.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCurrentTestPublication(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() input: PublicationActionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.publication.delete(
      actor,
      workspace,
      websiteId,
      undefined,
      input.idempotencyKey,
      request,
    );
  }

  @Get('integrations/blogger/test-posts/:externalPostId')
  @RequirePermissions('externalPosts.read')
  readDraft(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('externalPostId') externalPostId: string,
  ): Promise<ExternalPostSummary> {
    return this.publication.get(workspace.id, websiteId, externalPostId);
  }

  @Patch('integrations/blogger/test-posts/:externalPostId')
  @RequirePermissions('providerPublishing.update')
  updateDraft(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('externalPostId') externalPostId: string,
    @Body() input: UpdateTestDraftDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PublicationOperationResult> {
    return this.publication.update(actor, workspace, websiteId, externalPostId, input, request);
  }

  @Post('integrations/blogger/test-posts/:externalPostId/publish')
  @RequirePermissions('providerPublishing.publish')
  publishDraft(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('externalPostId') externalPostId: string,
    @Body() input: PublicationActionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PublicationOperationResult> {
    return this.publication.publish(
      actor,
      workspace,
      websiteId,
      externalPostId,
      input.idempotencyKey,
      request,
    );
  }

  @Delete('integrations/blogger/test-posts/:externalPostId')
  @RequirePermissions('providerPublishing.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDraft(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('externalPostId') externalPostId: string,
    @Body() input: PublicationActionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.publication.delete(
      actor,
      workspace,
      websiteId,
      externalPostId,
      input.idempotencyKey,
      request,
    );
  }
}
