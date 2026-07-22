import { HttpStatus, Injectable } from '@nestjs/common';
import type { WebsiteSummary } from '@ai-content-os/contracts';
import { DatabaseService, WebsiteStatus } from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import type { CreateWebsiteDto, UpdateWebsiteDto } from './dto/website.dto';

@Injectable()
export class WebsitesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string): Promise<WebsiteSummary[]> {
    const websites = await this.database.website.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return websites.map((website) => this.present(website));
  }

  async create(
    actor: AuthContext,
    workspace: WorkspaceContext,
    input: CreateWebsiteDto,
    request: AuthenticatedRequest,
  ): Promise<WebsiteSummary> {
    await this.assertSlugAvailable(workspace.id, input.slug);
    const website = await this.database.website.create({
      data: {
        workspaceId: workspace.id,
        name: input.name.trim(),
        slug: input.slug,
        platform: input.platform,
        language: input.language.toLowerCase(),
        locale: input.locale ?? null,
        timezone: input.timezone,
        description: input.description?.trim() || null,
        status: input.status ?? WebsiteStatus.DRAFT,
      },
    });
    await this.audit.record(
      {
        action: 'website.created',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId: website.id,
        targetType: 'Website',
        targetId: website.id,
      },
      request,
    );
    return this.present(website);
  }

  async get(workspaceId: string, websiteId: string): Promise<WebsiteSummary> {
    return this.present(await this.find(workspaceId, websiteId));
  }

  async update(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    input: UpdateWebsiteDto,
    request: AuthenticatedRequest,
  ): Promise<WebsiteSummary> {
    await this.find(workspace.id, websiteId);
    if (input.slug) await this.assertSlugAvailable(workspace.id, input.slug, websiteId);
    const website = await this.database.website.update({
      where: { id: websiteId },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.platform ? { platform: input.platform } : {}),
        ...(input.language ? { language: input.language.toLowerCase() } : {}),
        ...(input.locale !== undefined ? { locale: input.locale || null } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.description !== undefined
          ? { description: input.description.trim() || null }
          : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
    await this.audit.record(
      {
        action: 'website.updated',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'Website',
        targetId: websiteId,
      },
      request,
    );
    return this.present(website);
  }

  async deactivate(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    await this.find(workspace.id, websiteId);
    await this.database.website.update({
      where: { id: websiteId },
      data: { status: WebsiteStatus.INACTIVE, deletedAt: new Date() },
    });
    await this.audit.record(
      {
        action: 'website.deactivated',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'Website',
        targetId: websiteId,
      },
      request,
    );
  }

  async requireWebsite(workspaceId: string, websiteId: string): Promise<void> {
    await this.find(workspaceId, websiteId);
  }

  private async find(workspaceId: string, websiteId: string) {
    const website = await this.database.website.findFirst({
      where: { id: websiteId, workspaceId, deletedAt: null },
    });
    if (!website)
      throw new CodedHttpException(HttpStatus.NOT_FOUND, ERROR_CODES.notFound, 'Site introuvable.');
    return website;
  }

  private async assertSlugAvailable(
    workspaceId: string,
    slug: string,
    exceptId?: string,
  ): Promise<void> {
    const duplicate = await this.database.website.findFirst({
      where: { workspaceId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (duplicate) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.websiteSlugConflict,
        'Ce slug est déjà utilisé dans cet espace.',
      );
    }
  }

  private present(website: {
    id: string;
    workspaceId: string;
    name: string;
    slug: string;
    platform: 'BLOGGER' | 'WORDPRESS' | 'OTHER';
    language: string;
    locale: string | null;
    timezone: string;
    description: string | null;
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
    createdAt: Date;
    updatedAt: Date;
  }): WebsiteSummary {
    return {
      id: website.id,
      workspaceId: website.workspaceId,
      name: website.name,
      slug: website.slug,
      platform: website.platform,
      language: website.language,
      ...(website.locale ? { locale: website.locale } : {}),
      timezone: website.timezone,
      ...(website.description ? { description: website.description } : {}),
      status: website.status,
      createdAt: website.createdAt.toISOString(),
      updatedAt: website.updatedAt.toISOString(),
    };
  }
}
