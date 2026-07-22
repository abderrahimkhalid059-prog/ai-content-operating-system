import { HttpStatus, Injectable } from '@nestjs/common';
import type { WorkspaceMemberSummary, WorkspaceSummary } from '@ai-content-os/contracts';
import { DatabaseService, UserStatus, WorkspaceRole } from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { permissionsForRole } from '../../common/auth/permissions';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { presentUser } from '../auth/user.presenter';
import type {
  AddMemberDto,
  CreateWorkspaceDto,
  UpdateMemberDto,
  UpdateWorkspaceDto,
} from './dto/workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<WorkspaceSummary[]> {
    const memberships = await this.database.workspaceMember.findMany({
      where: { userId, workspace: { isActive: true }, user: { status: UserStatus.ACTIVE } },
      include: { workspace: true },
      orderBy: { workspace: { name: 'asc' } },
    });
    return memberships.map((membership) =>
      this.presentWorkspace(membership.workspace, membership.role),
    );
  }

  async create(
    actor: AuthContext,
    input: CreateWorkspaceDto,
    request: AuthenticatedRequest,
  ): Promise<WorkspaceSummary> {
    if (await this.database.workspace.findUnique({ where: { slug: input.slug } })) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.conflict,
        'Ce slug d’espace est déjà utilisé.',
      );
    }
    const workspace = await this.database.$transaction(async (transaction) => {
      const created = await transaction.workspace.create({
        data: { name: input.name.trim(), slug: input.slug },
      });
      await transaction.workspaceMember.create({
        data: { workspaceId: created.id, userId: actor.userId, role: WorkspaceRole.OWNER },
      });
      return created;
    });
    await this.audit.record(
      {
        action: 'workspace.created',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        targetType: 'Workspace',
        targetId: workspace.id,
      },
      request,
    );
    return this.presentWorkspace(workspace, WorkspaceRole.OWNER);
  }

  async get(context: WorkspaceContext): Promise<WorkspaceSummary> {
    const workspace = await this.database.workspace.findUniqueOrThrow({
      where: { id: context.id },
    });
    return this.presentWorkspace(workspace, context.role);
  }

  async update(
    actor: AuthContext,
    context: WorkspaceContext,
    input: UpdateWorkspaceDto,
    request: AuthenticatedRequest,
  ): Promise<WorkspaceSummary> {
    if (input.slug) {
      const duplicate = await this.database.workspace.findFirst({
        where: { slug: input.slug, id: { not: context.id } },
      });
      if (duplicate)
        throw new CodedHttpException(
          HttpStatus.CONFLICT,
          ERROR_CODES.conflict,
          'Ce slug d’espace est déjà utilisé.',
        );
    }
    const workspace = await this.database.workspace.update({
      where: { id: context.id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
      },
    });
    await this.audit.record(
      {
        action: 'workspace.updated',
        actorUserId: actor.userId,
        workspaceId: context.id,
        targetType: 'Workspace',
        targetId: context.id,
      },
      request,
    );
    return this.presentWorkspace(workspace, context.role);
  }

  async deactivate(
    actor: AuthContext,
    context: WorkspaceContext,
    request: AuthenticatedRequest,
  ): Promise<void> {
    await this.database.workspace.update({
      where: { id: context.id },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    await this.audit.record(
      {
        action: 'workspace.deactivated',
        actorUserId: actor.userId,
        workspaceId: context.id,
        targetType: 'Workspace',
        targetId: context.id,
      },
      request,
    );
  }

  async members(workspaceId: string): Promise<WorkspaceMemberSummary[]> {
    const members = await this.database.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return members.map((member) => ({
      id: member.id,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
      user: presentUser(member.user),
    }));
  }

  async addMember(
    actor: AuthContext,
    context: WorkspaceContext,
    input: AddMemberDto,
    request: AuthenticatedRequest,
  ): Promise<WorkspaceMemberSummary> {
    this.assertRoleAssignment(context.role, input.role);
    const user = await this.database.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new CodedHttpException(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.notFound,
        'Utilisateur actif introuvable.',
      );
    }
    const duplicate = await this.database.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: context.id } },
    });
    if (duplicate) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.memberAlreadyExists,
        'Cet utilisateur est déjà membre.',
      );
    }
    const member = await this.database.workspaceMember.create({
      data: { workspaceId: context.id, userId: user.id, role: input.role },
    });
    await this.audit.record(
      {
        action: 'workspace.member.added',
        actorUserId: actor.userId,
        workspaceId: context.id,
        targetType: 'WorkspaceMember',
        targetId: member.id,
        metadata: { role: member.role },
      },
      request,
    );
    return {
      id: member.id,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
      user: presentUser(user),
    };
  }

  async changeRole(
    actor: AuthContext,
    context: WorkspaceContext,
    memberId: string,
    input: UpdateMemberDto,
    request: AuthenticatedRequest,
  ): Promise<WorkspaceMemberSummary> {
    const member = await this.member(context.id, memberId);
    this.assertRoleMutation(context.role, member.role, input.role);
    const updated = await this.database.$transaction(
      async (transaction) => {
        if (member.role === WorkspaceRole.OWNER && input.role !== WorkspaceRole.OWNER) {
          await this.assertMoreThanOneActiveOwner(transaction, context.id);
        }
        return transaction.workspaceMember.update({
          where: { id: member.id },
          data: { role: input.role },
          include: { user: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    await this.audit.record(
      {
        action: 'workspace.member.role_changed',
        actorUserId: actor.userId,
        workspaceId: context.id,
        targetType: 'WorkspaceMember',
        targetId: memberId,
        metadata: { previousRole: member.role, role: input.role },
      },
      request,
    );
    return {
      id: updated.id,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      user: presentUser(updated.user),
    };
  }

  async removeMember(
    actor: AuthContext,
    context: WorkspaceContext,
    memberId: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    const member = await this.member(context.id, memberId);
    if (context.role === WorkspaceRole.ADMIN && member.role === WorkspaceRole.OWNER)
      this.roleForbidden();
    await this.database.$transaction(
      async (transaction) => {
        if (member.role === WorkspaceRole.OWNER) {
          await this.assertMoreThanOneActiveOwner(transaction, context.id);
        }
        await transaction.workspaceMember.delete({ where: { id: member.id } });
      },
      { isolationLevel: 'Serializable' },
    );
    await this.audit.record(
      {
        action: 'workspace.member.removed',
        actorUserId: actor.userId,
        workspaceId: context.id,
        targetType: 'WorkspaceMember',
        targetId: memberId,
        metadata: { role: member.role },
      },
      request,
    );
  }

  private presentWorkspace(
    workspace: {
      id: string;
      name: string;
      slug: string;
      isActive: boolean;
      deactivatedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    role: WorkspaceRole,
  ): WorkspaceSummary {
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      isActive: workspace.isActive,
      ...(workspace.deactivatedAt ? { deactivatedAt: workspace.deactivatedAt.toISOString() } : {}),
      role,
      permissions: permissionsForRole(role),
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    };
  }

  private assertRoleAssignment(actorRole: WorkspaceRole, role: WorkspaceRole): void {
    if (actorRole === WorkspaceRole.ADMIN && role === WorkspaceRole.OWNER) this.roleForbidden();
  }

  private assertRoleMutation(
    actorRole: WorkspaceRole,
    current: WorkspaceRole,
    next: WorkspaceRole,
  ): void {
    if (
      actorRole === WorkspaceRole.ADMIN &&
      (current === WorkspaceRole.OWNER || next === WorkspaceRole.OWNER)
    ) {
      this.roleForbidden();
    }
  }

  private async member(workspaceId: string, memberId: string) {
    const member = await this.database.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      include: { user: true },
    });
    if (!member)
      throw new CodedHttpException(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.notFound,
        'Membre introuvable.',
      );
    return member;
  }

  private async assertMoreThanOneActiveOwner(
    transaction: Pick<DatabaseService, 'workspaceMember'>,
    workspaceId: string,
  ): Promise<void> {
    const count = await transaction.workspaceMember.count({
      where: { workspaceId, role: WorkspaceRole.OWNER, user: { status: UserStatus.ACTIVE } },
    });
    if (count <= 1) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.workspaceLastOwner,
        'Le dernier Owner actif ne peut pas être retiré ou rétrogradé.',
      );
    }
  }

  private roleForbidden(): never {
    throw new CodedHttpException(
      HttpStatus.FORBIDDEN,
      ERROR_CODES.memberRoleForbidden,
      'Un Admin ne peut pas gérer un Owner.',
    );
  }
}
