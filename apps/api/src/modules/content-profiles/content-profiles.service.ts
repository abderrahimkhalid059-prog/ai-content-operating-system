import { HttpStatus, Injectable } from '@nestjs/common';
import type { ContentProfileSummary } from '@ai-content-os/contracts';
import { ContentProfileStatus, DatabaseService } from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { WebsitesService } from '../websites/websites.service';
import type {
  CreateContentProfileDto,
  EditorialRules,
  UpdateContentProfileDto,
} from './dto/content-profile.dto';

@Injectable()
export class ContentProfilesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly websites: WebsitesService,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string, websiteId: string): Promise<ContentProfileSummary[]> {
    await this.websites.requireWebsite(workspaceId, websiteId);
    const profiles = await this.database.contentProfile.findMany({
      where: { workspaceId, websiteId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return profiles.map((profile) => this.present(profile));
  }

  async create(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    input: CreateContentProfileDto,
    request: AuthenticatedRequest,
  ): Promise<ContentProfileSummary> {
    await this.websites.requireWebsite(workspace.id, websiteId);
    this.validateJson(input.editorialRules, input.prohibitedTopics);
    const duplicate = await this.database.contentProfile.findUnique({
      where: { websiteId_name: { websiteId, name: input.name.trim() } },
    });
    if (duplicate) this.conflict();
    const profile = await this.database.$transaction(
      async (transaction) => {
        if (input.isDefault) {
          await transaction.contentProfile.updateMany({
            where: { workspaceId: workspace.id, websiteId, isDefault: true },
            data: { isDefault: false },
          });
        }
        return transaction.contentProfile.create({
          data: {
            workspaceId: workspace.id,
            websiteId,
            name: input.name.trim(),
            language: input.language.toLowerCase(),
            locale: input.locale ?? null,
            countryCode: input.countryCode?.toUpperCase() ?? null,
            tone: input.tone.trim(),
            targetAudience: input.targetAudience?.trim() || null,
            editorialRules: input.editorialRules,
            prohibitedTopics: input.prohibitedTopics ?? [],
            isDefault: input.isDefault ?? false,
            status: ContentProfileStatus.ACTIVE,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    await this.audit.record(
      {
        action: 'content_profile.created',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentProfile',
        targetId: profile.id,
        metadata: { isDefault: profile.isDefault },
      },
      request,
    );
    return this.present(profile);
  }

  async get(
    workspaceId: string,
    websiteId: string,
    profileId: string,
  ): Promise<ContentProfileSummary> {
    await this.websites.requireWebsite(workspaceId, websiteId);
    return this.present(await this.find(workspaceId, websiteId, profileId));
  }

  async update(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    profileId: string,
    input: UpdateContentProfileDto,
    request: AuthenticatedRequest,
  ): Promise<ContentProfileSummary> {
    const current = await this.find(workspace.id, websiteId, profileId);
    if (input.editorialRules || input.prohibitedTopics) {
      this.validateJson(
        input.editorialRules ?? (current.editorialRules as EditorialRules),
        input.prohibitedTopics,
      );
    }
    if (input.name && input.name.trim() !== current.name) {
      const duplicate = await this.database.contentProfile.findUnique({
        where: { websiteId_name: { websiteId, name: input.name.trim() } },
      });
      if (duplicate) this.conflict();
    }
    const profile = await this.database.contentProfile.update({
      where: { id: profileId },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.language ? { language: input.language.toLowerCase() } : {}),
        ...(input.locale !== undefined ? { locale: input.locale || null } : {}),
        ...(input.countryCode !== undefined
          ? { countryCode: input.countryCode?.toUpperCase() || null }
          : {}),
        ...(input.tone ? { tone: input.tone.trim() } : {}),
        ...(input.targetAudience !== undefined
          ? { targetAudience: input.targetAudience.trim() || null }
          : {}),
        ...(input.editorialRules ? { editorialRules: input.editorialRules } : {}),
        ...(input.prohibitedTopics ? { prohibitedTopics: input.prohibitedTopics } : {}),
        ...(input.status
          ? {
              status: input.status,
              ...(input.status === ContentProfileStatus.INACTIVE ? { isDefault: false } : {}),
            }
          : {}),
      },
    });
    await this.audit.record(
      {
        action: 'content_profile.updated',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentProfile',
        targetId: profileId,
      },
      request,
    );
    return this.present(profile);
  }

  async deactivate(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    profileId: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    await this.find(workspace.id, websiteId, profileId);
    await this.database.contentProfile.update({
      where: { id: profileId },
      data: { status: ContentProfileStatus.INACTIVE, isDefault: false },
    });
    await this.audit.record(
      {
        action: 'content_profile.deactivated',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentProfile',
        targetId: profileId,
      },
      request,
    );
  }

  async setDefault(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    profileId: string,
    request: AuthenticatedRequest,
  ): Promise<ContentProfileSummary> {
    const profile = await this.find(workspace.id, websiteId, profileId);
    if (profile.status !== ContentProfileStatus.ACTIVE) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.contentProfileDefaultConflict,
        'Un profil inactif ne peut pas devenir le profil par défaut.',
      );
    }
    const updated = await this.database.$transaction(
      async (transaction) => {
        await transaction.contentProfile.updateMany({
          where: { workspaceId: workspace.id, websiteId, isDefault: true },
          data: { isDefault: false },
        });
        return transaction.contentProfile.update({
          where: { id: profileId },
          data: { isDefault: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    await this.audit.record(
      {
        action: 'content_profile.default_changed',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentProfile',
        targetId: profileId,
      },
      request,
    );
    return this.present(updated);
  }

  private async find(workspaceId: string, websiteId: string, profileId: string) {
    const profile = await this.database.contentProfile.findFirst({
      where: { id: profileId, workspaceId, websiteId },
    });
    if (!profile)
      throw new CodedHttpException(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.notFound,
        'Profil éditorial introuvable.',
      );
    return profile;
  }

  private validateJson(editorialRules: EditorialRules, prohibitedTopics?: string[]): void {
    const value = JSON.stringify({ editorialRules, prohibitedTopics });
    if (Buffer.byteLength(value, 'utf8') > 16_384) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'La configuration éditoriale dépasse 16 Ko.',
      );
    }
    if (Object.keys(editorialRules).some((key) => /prompt|provider|model/i.test(key))) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Les prompts et fournisseurs IA ne font pas partie des profils Phase 1.',
      );
    }
  }

  private conflict(): never {
    throw new CodedHttpException(
      HttpStatus.CONFLICT,
      ERROR_CODES.conflict,
      'Un profil portant ce nom existe déjà pour ce site.',
    );
  }

  private present(profile: {
    id: string;
    workspaceId: string;
    websiteId: string;
    name: string;
    language: string;
    locale: string | null;
    countryCode: string | null;
    tone: string;
    targetAudience: string | null;
    editorialRules: unknown;
    prohibitedTopics: unknown;
    isDefault: boolean;
    status: 'ACTIVE' | 'INACTIVE';
    createdAt: Date;
    updatedAt: Date;
  }): ContentProfileSummary {
    return {
      id: profile.id,
      workspaceId: profile.workspaceId,
      websiteId: profile.websiteId,
      name: profile.name,
      language: profile.language,
      ...(profile.locale ? { locale: profile.locale } : {}),
      ...(profile.countryCode ? { countryCode: profile.countryCode } : {}),
      tone: profile.tone,
      ...(profile.targetAudience ? { targetAudience: profile.targetAudience } : {}),
      editorialRules: profile.editorialRules,
      ...(profile.prohibitedTopics !== null ? { prohibitedTopics: profile.prohibitedTopics } : {}),
      isDefault: profile.isDefault,
      status: profile.status,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
