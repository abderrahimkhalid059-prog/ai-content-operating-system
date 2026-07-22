import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ContentProfileSummary } from '@ai-content-os/contracts';
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
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { ContentProfilesService } from './content-profiles.service';
import { CreateContentProfileDto, UpdateContentProfileDto } from './dto/content-profile.dto';

@ApiTags('content profiles')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard, PermissionGuard)
@Controller({ path: 'workspaces/:workspaceId/websites/:websiteId/content-profiles', version: '1' })
export class ContentProfilesController {
  constructor(private readonly profiles: ContentProfilesService) {}

  @Get()
  @RequirePermissions('contentProfiles.read')
  list(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
  ): Promise<ContentProfileSummary[]> {
    return this.profiles.list(workspace.id, websiteId);
  }

  @Post()
  @RequirePermissions('contentProfiles.create')
  create(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() input: CreateContentProfileDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentProfileSummary> {
    return this.profiles.create(actor, workspace, websiteId, input, request);
  }

  @Get(':profileId')
  @RequirePermissions('contentProfiles.read')
  get(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<ContentProfileSummary> {
    return this.profiles.get(workspace.id, websiteId, profileId);
  }

  @Patch(':profileId')
  @RequirePermissions('contentProfiles.update')
  update(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() input: UpdateContentProfileDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentProfileSummary> {
    return this.profiles.update(actor, workspace, websiteId, profileId, input, request);
  }

  @Delete(':profileId')
  @RequirePermissions('contentProfiles.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.profiles.deactivate(actor, workspace, websiteId, profileId, request);
  }

  @Post(':profileId/set-default')
  @RequirePermissions('contentProfiles.update')
  setDefault(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentProfileSummary> {
    return this.profiles.setDefault(actor, workspace, websiteId, profileId, request);
  }
}
