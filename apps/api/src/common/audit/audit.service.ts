import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, type Prisma } from '@ai-content-os/database';
import type { AuthenticatedRequest } from '../auth/auth.types';

type AuditScalar = string | number | boolean | null | undefined;

export interface AuditInput {
  action: string;
  actorUserId?: string;
  workspaceId?: string;
  websiteId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, AuditScalar>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly database: DatabaseService) {}

  async record(input: AuditInput, request?: AuthenticatedRequest): Promise<void> {
    const metadata: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      if (value === undefined || /password|token|cookie|authorization|secret|hash/i.test(key))
        continue;
      metadata[key] = typeof value === 'string' ? value.slice(0, 500) : value;
    }
    try {
      const data: Prisma.AuditLogUncheckedCreateInput = {
        action: input.action,
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.websiteId ? { websiteId: input.websiteId } : {}),
        ...(input.targetType ? { targetType: input.targetType } : {}),
        ...(input.targetId ? { targetId: input.targetId } : {}),
        ...(request?.requestId
          ? { requestId: request.requestId, correlationId: request.requestId }
          : {}),
        ...(request?.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
        ...(request?.header('user-agent')
          ? { userAgent: request.header('user-agent')!.slice(0, 512) }
          : {}),
        metadata,
      };
      await this.database.auditLog.create({ data });
    } catch (error) {
      this.logger.warn(
        { action: input.action, error: error instanceof Error ? error.message : 'unknown' },
        'Audit record could not be persisted',
      );
    }
  }
}
