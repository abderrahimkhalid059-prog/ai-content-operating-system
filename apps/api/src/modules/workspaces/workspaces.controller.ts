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
import type { WorkspaceMemberSummary, WorkspaceSummary } from '@ai-content-os/contracts';
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
import {
  AddMemberDto,
  CreateWorkspaceDto,
  UpdateMemberDto,
  UpdateWorkspaceDto,
} from './dto/workspace.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller({ path: 'workspaces', version: '1' })
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() actor: AuthContext): Promise<WorkspaceSummary[]> {
    return this.workspaces.list(actor.userId);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthContext,
    @Body() input: CreateWorkspaceDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<WorkspaceSummary> {
    return this.workspaces.create(actor, input, request);
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermissions('workspace.read')
  get(@CurrentWorkspace() workspace: WorkspaceContext): Promise<WorkspaceSummary> {
    return this.workspaces.get(workspace);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermissions('workspace.update')
  update(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() input: UpdateWorkspaceDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<WorkspaceSummary> {
    return this.workspaces.update(actor, workspace, input, request);
  }

  @Post(':workspaceId/deactivate')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermissions('workspace.deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.workspaces.deactivate(actor, workspace, request);
  }

  @Get(':workspaceId/members')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermissions('members.read')
  members(@CurrentWorkspace() workspace: WorkspaceContext): Promise<WorkspaceMemberSummary[]> {
    return this.workspaces.members(workspace.id);
  }

  @Post(':workspaceId/members')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermissions('members.create')
  addMember(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() input: AddMemberDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<WorkspaceMemberSummary> {
    return this.workspaces.addMember(actor, workspace, input, request);
  }

  @Patch(':workspaceId/members/:memberId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermissions('members.update')
  changeRole(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() input: UpdateMemberDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<WorkspaceMemberSummary> {
    return this.workspaces.changeRole(actor, workspace, memberId, input, request);
  }

  @Delete(':workspaceId/members/:memberId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermissions('members.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.workspaces.removeMember(actor, workspace, memberId, request);
  }
}
