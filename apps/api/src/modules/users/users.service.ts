import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  PaginationResponse,
  SafeUserSummary,
  TemporaryPasswordResponse,
} from '@ai-content-os/contracts';
import { DatabaseService, UserStatus, WorkspaceRole } from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { presentUser } from '../auth/user.presenter';
import type { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    query: UserQueryDto,
  ): Promise<PaginationResponse<SafeUserSummary>> {
    await this.assertManager(actor.userId);
    const search = query.search?.trim();
    const where = search
      ? {
          OR: [
            { email: { contains: search.toLowerCase() } },
            { displayName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [users, total] = await this.database.$transaction([
      this.database.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.user.count({ where }),
    ]);
    return {
      data: users.map(presentUser),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async create(
    actor: AuthContext,
    input: CreateUserDto,
    request: AuthenticatedRequest,
  ): Promise<TemporaryPasswordResponse> {
    await this.assertManager(actor.userId);
    const email = input.email.trim().toLowerCase();
    if (await this.database.user.findUnique({ where: { email } })) this.emailConflict();
    const temporaryPassword = this.passwords.temporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const user = await this.database.user.create({
      data: {
        email,
        displayName: input.displayName?.trim() || null,
        passwordHash,
        status: UserStatus.ACTIVE,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
    });
    await this.audit.record(
      { action: 'user.created', actorUserId: actor.userId, targetType: 'User', targetId: user.id },
      request,
    );
    return { user: presentUser(user), temporaryPassword };
  }

  async get(actor: AuthContext, userId: string): Promise<SafeUserSummary> {
    await this.assertManager(actor.userId);
    return presentUser(await this.find(userId));
  }

  async update(
    actor: AuthContext,
    userId: string,
    input: UpdateUserDto,
    request: AuthenticatedRequest,
  ): Promise<SafeUserSummary> {
    await this.assertCanManage(actor.userId, userId);
    const email = input.email?.trim().toLowerCase();
    if (email) {
      const conflict = await this.database.user.findFirst({
        where: { email, id: { not: userId } },
      });
      if (conflict) this.emailConflict();
    }
    const user = await this.database.user.update({
      where: { id: userId },
      data: {
        ...(email ? { email } : {}),
        ...(input.displayName !== undefined
          ? { displayName: input.displayName.trim() || null }
          : {}),
      },
    });
    await this.audit.record(
      { action: 'user.updated', actorUserId: actor.userId, targetType: 'User', targetId: userId },
      request,
    );
    return presentUser(user);
  }

  async deactivate(
    actor: AuthContext,
    userId: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    if (actor.userId === userId) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Vous ne pouvez pas désactiver votre propre compte.',
      );
    }
    await this.assertCanManage(actor.userId, userId);
    await this.database.$transaction(
      async (transaction) => {
        const owned = await transaction.workspaceMember.findMany({
          where: { userId, role: WorkspaceRole.OWNER, workspace: { isActive: true } },
          select: { workspaceId: true },
        });
        for (const membership of owned) {
          const activeOwners = await transaction.workspaceMember.count({
            where: {
              workspaceId: membership.workspaceId,
              role: WorkspaceRole.OWNER,
              user: { status: UserStatus.ACTIVE },
            },
          });
          if (activeOwners <= 1) {
            throw new CodedHttpException(
              HttpStatus.CONFLICT,
              ERROR_CODES.workspaceLastOwner,
              'Le dernier Owner actif ne peut pas être désactivé.',
            );
          }
        }
        await transaction.user.update({
          where: { id: userId },
          data: { status: UserStatus.INACTIVE, securityVersion: { increment: 1 } },
        });
        await transaction.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'USER_DEACTIVATED' },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    await this.audit.record(
      {
        action: 'user.deactivated',
        actorUserId: actor.userId,
        targetType: 'User',
        targetId: userId,
      },
      request,
    );
  }

  async reactivate(
    actor: AuthContext,
    userId: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    await this.assertCanManage(actor.userId, userId);
    await this.database.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
    await this.audit.record(
      {
        action: 'user.reactivated',
        actorUserId: actor.userId,
        targetType: 'User',
        targetId: userId,
      },
      request,
    );
  }

  async resetPassword(
    actor: AuthContext,
    userId: string,
    request: AuthenticatedRequest,
  ): Promise<TemporaryPasswordResponse> {
    await this.assertCanManage(actor.userId, userId);
    const temporaryPassword = this.passwords.temporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const [user] = await this.database.$transaction([
      this.database.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          securityVersion: { increment: 1 },
        },
      }),
      this.database.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'ADMIN_PASSWORD_RESET' },
      }),
    ]);
    await this.audit.record(
      {
        action: 'user.password.reset',
        actorUserId: actor.userId,
        targetType: 'User',
        targetId: userId,
      },
      request,
    );
    return { user: presentUser(user), temporaryPassword };
  }

  async revokeSessions(
    actor: AuthContext,
    userId: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    await this.assertCanManage(actor.userId, userId);
    await this.auth.revokeUserSessions(userId, 'ADMIN_REVOKED');
    await this.audit.record(
      {
        action: 'user.sessions.revoked',
        actorUserId: actor.userId,
        targetType: 'User',
        targetId: userId,
      },
      request,
    );
  }

  private async assertManager(userId: string): Promise<WorkspaceRole[]> {
    const memberships = await this.database.workspaceMember.findMany({
      where: {
        userId,
        role: { in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN] },
        workspace: { isActive: true },
      },
      select: { role: true },
    });
    if (!memberships.length) {
      throw new CodedHttpException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.forbidden,
        'Administration des utilisateurs interdite.',
      );
    }
    return memberships.map((membership) => membership.role);
  }

  private async assertCanManage(actorUserId: string, targetUserId: string): Promise<void> {
    const actorRoles = await this.assertManager(actorUserId);
    await this.find(targetUserId);
    if (!actorRoles.includes(WorkspaceRole.OWNER)) {
      const targetOwns = await this.database.workspaceMember.count({
        where: { userId: targetUserId, role: WorkspaceRole.OWNER, workspace: { isActive: true } },
      });
      if (targetOwns) {
        throw new CodedHttpException(
          HttpStatus.FORBIDDEN,
          ERROR_CODES.memberRoleForbidden,
          'Un Admin ne peut pas gérer un Owner.',
        );
      }
    }
  }

  private async find(userId: string) {
    const user = await this.database.user.findUnique({ where: { id: userId } });
    if (!user)
      throw new CodedHttpException(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.notFound,
        'Utilisateur introuvable.',
      );
    return user;
  }

  private emailConflict(): never {
    throw new CodedHttpException(
      HttpStatus.CONFLICT,
      ERROR_CODES.userEmailConflict,
      'Cette adresse e-mail est déjà utilisée.',
    );
  }
}
