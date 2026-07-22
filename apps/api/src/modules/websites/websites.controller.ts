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
import type { WebsiteSummary } from '@ai-content-os/contracts';
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
import { CreateWebsiteDto, UpdateWebsiteDto } from './dto/website.dto';
import { WebsitesService } from './websites.service';

@ApiTags('websites')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard, PermissionGuard)
@Controller({ path: 'workspaces/:workspaceId/websites', version: '1' })
export class WebsitesController {
  constructor(private readonly websites: WebsitesService) {}

  @Get()
  @RequirePermissions('websites.read')
  list(@CurrentWorkspace() workspace: WorkspaceContext): Promise<WebsiteSummary[]> {
    return this.websites.list(workspace.id);
  }

  @Post()
  @RequirePermissions('websites.create')
  create(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() input: CreateWebsiteDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<WebsiteSummary> {
    return this.websites.create(actor, workspace, input, request);
  }

  @Get(':websiteId')
  @RequirePermissions('websites.read')
  get(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
  ): Promise<WebsiteSummary> {
    return this.websites.get(workspace.id, websiteId);
  }

  @Patch(':websiteId')
  @RequirePermissions('websites.update')
  update(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() input: UpdateWebsiteDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<WebsiteSummary> {
    return this.websites.update(actor, workspace, websiteId, input, request);
  }

  @Delete(':websiteId')
  @RequirePermissions('websites.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.websites.deactivate(actor, workspace, websiteId, request);
  }
}
