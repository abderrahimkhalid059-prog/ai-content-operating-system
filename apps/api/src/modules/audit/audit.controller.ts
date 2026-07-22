import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuditLogSummary } from '@ai-content-os/contracts';
import { DatabaseService } from '@ai-content-os/database';
import { PermissionGuard } from '../../common/auth/permission.guard';
import type { WorkspaceContext } from '../../common/auth/auth.types';
import { WorkspaceGuard } from '../../common/auth/workspace.guard';
import { CurrentWorkspace, RequirePermissions } from '../../common/decorators/auth.decorators';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard, PermissionGuard)
@Controller({ path: 'workspaces/:workspaceId/audit-logs', version: '1' })
export class AuditController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @RequirePermissions('audit.read')
  async list(@CurrentWorkspace() workspace: WorkspaceContext): Promise<AuditLogSummary[]> {
    const logs = await this.database.auditLog.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return logs.map((log) => ({
      id: log.id,
      ...(log.actorUserId ? { actorUserId: log.actorUserId } : {}),
      ...(log.workspaceId ? { workspaceId: log.workspaceId } : {}),
      ...(log.websiteId ? { websiteId: log.websiteId } : {}),
      ...(log.targetType ? { targetType: log.targetType } : {}),
      ...(log.targetId ? { targetId: log.targetId } : {}),
      action: log.action,
      ...(log.requestId ? { requestId: log.requestId } : {}),
      ...(log.metadata !== null ? { metadata: log.metadata } : {}),
      createdAt: log.createdAt.toISOString(),
    }));
  }
}
