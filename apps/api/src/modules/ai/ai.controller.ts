import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  AiConfigurationSummary,
  AiProviderDescriptor,
  AiProviderTestResult,
  AiRunSummary,
  ResolvedAiConfiguration,
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
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { AiService } from './ai.service';
import { AiRunsQueryDto, AiScopeQueryDto, UpsertAiConfigurationDto } from './dto/ai.dto';

@ApiTags('AI infrastructure')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard, PermissionGuard)
@Controller({ path: 'workspaces/:workspaceId/ai', version: '1' })
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('providers')
  @RequirePermissions('ai.config.read')
  providers(): AiProviderDescriptor[] {
    return this.ai.listProviders();
  }

  @Get('configurations')
  @RequirePermissions('ai.config.read')
  configurations(
    @CurrentWorkspace() workspace: WorkspaceContext,
  ): Promise<AiConfigurationSummary[]> {
    return this.ai.listConfigurations(workspace.id);
  }

  @Put('configurations')
  @RequirePermissions('ai.config.update')
  upsert(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() input: UpsertAiConfigurationDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AiConfigurationSummary> {
    return this.ai.upsertConfiguration(actor, workspace, input, request);
  }

  @Get('resolved-configuration')
  @RequirePermissions('ai.config.read')
  resolved(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Query() query: AiScopeQueryDto,
  ): Promise<ResolvedAiConfiguration> {
    return this.ai.resolve(workspace.id, query);
  }

  @Post('configurations/:configurationId/test')
  @RequirePermissions('ai.config.test')
  test(
    @CurrentUser() actor: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('configurationId', ParseUUIDPipe) configurationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<AiProviderTestResult> {
    return this.ai.testConfiguration(actor, workspace, configurationId, request);
  }

  @Get('runs')
  @RequirePermissions('ai.runs.read')
  runs(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Query() query: AiRunsQueryDto,
  ): Promise<AiRunSummary[]> {
    return this.ai.listRuns(workspace.id, query);
  }
}
