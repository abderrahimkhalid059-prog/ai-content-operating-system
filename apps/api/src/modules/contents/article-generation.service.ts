import { HttpStatus, Injectable } from '@nestjs/common';
import type { AiGenerationCandidateSummary } from '@ai-content-os/contracts';
import {
  AiGenerationCandidateStatus,
  ContentEditorialStatus,
  ContentProfileStatus,
  DatabaseService,
  Prisma,
} from '@ai-content-os/database';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { AiProviderFactory } from '../ai/ai-provider.factory';
import { AiService } from '../ai/ai.service';
import { WebsitesService } from '../websites/websites.service';
import { parseArticleDraft } from './article-generation.domain';
import { ContentsService } from './contents.service';
import type { GenerateArticleDraftDto } from './dto/ai-generation.dto';

type CandidateWithRun = Prisma.AiGenerationCandidateGetPayload<{ include: { aiRun: true } }>;

const generatableStatuses = new Set<ContentEditorialStatus>([
  ContentEditorialStatus.IDEA,
  ContentEditorialStatus.RESEARCHING,
  ContentEditorialStatus.OUTLINED,
  ContentEditorialStatus.DRAFT,
  ContentEditorialStatus.CHANGES_REQUESTED,
]);

@Injectable()
export class ArticleGenerationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly websites: WebsitesService,
    private readonly ai: AiService,
    private readonly aiFactory: AiProviderFactory,
    private readonly contents: ContentsService,
    private readonly audit: AuditService,
  ) {}

  async generate(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    input: GenerateArticleDraftDto,
    request: AuthenticatedRequest,
  ): Promise<AiGenerationCandidateSummary> {
    const website = await this.websites.get(workspace.id, websiteId);
    const content = await this.database.contentItem.findFirst({
      where: { id: contentId, workspaceId: workspace.id, websiteId },
    });
    if (!content) this.notFound();
    if (!generatableStatuses.has(content.editorialStatus)) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.contentInvalidTransition,
        'La génération IA est réservée aux contenus encore éditables.',
      );
    }
    if (content.version !== input.expectedVersion) this.stale();
    const profile = await this.database.contentProfile.findFirst({
      where: {
        id: input.contentProfileId,
        workspaceId: workspace.id,
        websiteId,
        status: ContentProfileStatus.ACTIVE,
      },
    });
    if (!profile) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.contentProfileInvalid,
        'Le profil éditorial doit être actif et appartenir au même site.',
      );
    }
    const idempotencyKey = `article:${contentId}:${input.idempotencyKey}`;
    const existing = await this.database.aiGenerationCandidate.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId: workspace.id, idempotencyKey } },
      include: { aiRun: true },
    });
    if (existing) return this.replay(existing);

    let candidate: CandidateWithRun;
    try {
      candidate = await this.database.aiGenerationCandidate.create({
        data: {
          workspaceId: workspace.id,
          websiteId,
          contentItemId: contentId,
          contentProfileId: profile.id,
          createdByUserId: actor.userId,
          idempotencyKey,
          baseRevisionNumber: content.version,
          promptIdentifier: 'article.draft',
          promptVersion: 1,
        },
        include: { aiRun: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.database.aiGenerationCandidate.findUniqueOrThrow({
          where: { workspaceId_idempotencyKey: { workspaceId: workspace.id, idempotencyKey } },
          include: { aiRun: true },
        });
        return this.replay(duplicate);
      }
      throw error;
    }
    await this.audit.record(
      {
        action: 'content.ai_generation_requested',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'ContentItem',
        targetId: contentId,
        metadata: {
          candidateId: candidate.id,
          baseRevisionNumber: content.version,
          contentProfileId: profile.id,
          promptIdentifier: candidate.promptIdentifier,
          promptVersion: candidate.promptVersion,
        },
      },
      request,
    );

    const prompt = this.aiFactory.prompts.render('article.draft', 1, {
      website: website.name,
      websiteLanguage: website.language,
      websiteLocale: website.locale ?? 'non défini',
      profile: profile.name,
      profileLanguage: profile.language,
      profileLocale: profile.locale ?? 'non défini',
      tone: profile.tone,
      defaultAudience: profile.targetAudience ?? 'non défini',
      editorialRules: this.safeContext(profile.editorialRules),
      prohibitedTopics: this.safeContext(profile.prohibitedTopics ?? []),
      topic: input.topic.trim(),
      angle: input.angle?.trim() || 'non défini',
      requestedAudience: input.targetAudience?.trim() || 'non défini',
      instructions: input.instructions?.trim() || 'aucune',
      approximateLength: input.approximateLength
        ? `${input.approximateLength} mots environ`
        : 'non définie',
      currentTitle: content.title,
    });
    const runKey = `article-generation:${candidate.id}`;
    try {
      const execution = await this.ai.executeBusinessOperation({
        workspaceId: workspace.id,
        websiteId,
        contentProfileId: profile.id,
        idempotencyKey: runKey,
        operation: 'ARTICLE_DRAFT_GENERATION',
        prompt,
        outputFormat: 'JSON',
        correlationId: request.requestId,
        validate: (result) => parseArticleDraft(result.text),
      });
      candidate = await this.database.aiGenerationCandidate.update({
        where: { id: candidate.id },
        data: {
          aiRunId: execution.run.id,
          status: AiGenerationCandidateStatus.READY,
          title: execution.value.title,
          excerpt: execution.value.excerpt ?? null,
          htmlContent: execution.value.bodyHtml,
          suggestedSlug: execution.value.suggestedSlug ?? null,
          metaDescription: execution.value.metaDescription ?? null,
          suggestedLabels: execution.value.suggestedLabels,
          warnings: execution.value.warnings,
        },
        include: { aiRun: true },
      });
      await this.audit.record(
        {
          action: 'content.ai_generation_completed',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'ContentItem',
          targetId: contentId,
          metadata: {
            candidateId: candidate.id,
            aiRunId: execution.run.id,
            providerKey: execution.run.providerKey,
            model: execution.run.model,
            promptVersion: execution.run.promptVersion,
            baseRevisionNumber: candidate.baseRevisionNumber,
          },
        },
        request,
      );
      return this.present(candidate);
    } catch (error) {
      const run = await this.database.aiRun.findUnique({
        where: {
          workspaceId_idempotencyKey: { workspaceId: workspace.id, idempotencyKey: runKey },
        },
      });
      const errorCode = run?.errorCode ?? ERROR_CODES.aiGenerationFailed;
      await this.database.aiGenerationCandidate.update({
        where: { id: candidate.id },
        data: {
          status: AiGenerationCandidateStatus.FAILED,
          aiRunId: run?.id ?? null,
          errorCode,
        },
      });
      await this.audit.record(
        {
          action: 'content.ai_generation_failed',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'ContentItem',
          targetId: contentId,
          metadata: { candidateId: candidate.id, aiRunId: run?.id ?? null, errorCode },
        },
        request,
      );
      throw error;
    }
  }

  async apply(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    candidateId: string,
    request: AuthenticatedRequest,
  ) {
    return this.contents.applyAiGenerationCandidate(
      actor,
      workspace,
      websiteId,
      contentId,
      candidateId,
      request,
    );
  }

  async discard(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    contentId: string,
    candidateId: string,
    request: AuthenticatedRequest,
  ): Promise<AiGenerationCandidateSummary> {
    const candidate = await this.find(workspace.id, websiteId, contentId, candidateId);
    if (candidate.status === AiGenerationCandidateStatus.APPLIED) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.aiGenerationAlreadyApplied,
        'Ce brouillon IA a déjà été utilisé.',
      );
    }
    if (candidate.status !== AiGenerationCandidateStatus.DISCARDED) {
      await this.database.aiGenerationCandidate.updateMany({
        where: {
          id: candidate.id,
          workspaceId: workspace.id,
          websiteId,
          contentItemId: contentId,
          status: { in: [AiGenerationCandidateStatus.READY, AiGenerationCandidateStatus.FAILED] },
        },
        data: { status: AiGenerationCandidateStatus.DISCARDED },
      });
      await this.audit.record(
        {
          action: 'content.ai_generation_discarded',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'ContentItem',
          targetId: contentId,
          metadata: { candidateId: candidate.id, aiRunId: candidate.aiRunId },
        },
        request,
      );
    }
    return this.present(await this.find(workspace.id, websiteId, contentId, candidateId));
  }

  private replay(candidate: CandidateWithRun): AiGenerationCandidateSummary {
    if (candidate.status === AiGenerationCandidateStatus.PENDING) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.aiGenerationInProgress,
        'Cette génération IA est déjà en cours.',
      );
    }
    if (candidate.status === AiGenerationCandidateStatus.FAILED) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        candidate.errorCode ?? ERROR_CODES.aiGenerationFailed,
        'Cette tentative de génération a échoué. Lancez une nouvelle tentative explicite.',
      );
    }
    if (candidate.status === AiGenerationCandidateStatus.DISCARDED) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.aiGenerationDiscarded,
        'Ce brouillon IA a été ignoré.',
      );
    }
    return this.present(candidate);
  }

  private find(workspaceId: string, websiteId: string, contentId: string, candidateId: string) {
    return this.database.aiGenerationCandidate
      .findFirst({
        where: { id: candidateId, workspaceId, websiteId, contentItemId: contentId },
        include: { aiRun: true },
      })
      .then((candidate) => candidate ?? this.notFound());
  }

  private present(candidate: CandidateWithRun): AiGenerationCandidateSummary {
    const ready = Boolean(candidate.title && candidate.htmlContent);
    return {
      id: candidate.id,
      workspaceId: candidate.workspaceId,
      websiteId: candidate.websiteId,
      contentItemId: candidate.contentItemId,
      contentProfileId: candidate.contentProfileId,
      ...(candidate.aiRunId ? { aiRunId: candidate.aiRunId } : {}),
      status: candidate.status,
      baseRevisionNumber: candidate.baseRevisionNumber,
      ...(ready
        ? {
            draft: {
              title: candidate.title!,
              ...(candidate.excerpt ? { excerpt: candidate.excerpt } : {}),
              bodyHtml: candidate.htmlContent!,
              ...(candidate.suggestedSlug ? { suggestedSlug: candidate.suggestedSlug } : {}),
              ...(candidate.metaDescription ? { metaDescription: candidate.metaDescription } : {}),
              suggestedLabels: this.stringArray(candidate.suggestedLabels),
              warnings: this.stringArray(candidate.warnings),
            },
          }
        : {}),
      ...(candidate.aiRun
        ? { providerKey: candidate.aiRun.providerKey, model: candidate.aiRun.model }
        : {}),
      promptIdentifier: candidate.promptIdentifier,
      promptVersion: candidate.promptVersion,
      createdByUserId: candidate.createdByUserId,
      ...(candidate.appliedByUserId ? { appliedByUserId: candidate.appliedByUserId } : {}),
      ...(candidate.appliedRevisionNumber
        ? { appliedRevisionNumber: candidate.appliedRevisionNumber }
        : {}),
      ...(candidate.errorCode ? { errorCode: candidate.errorCode } : {}),
      createdAt: candidate.createdAt.toISOString(),
      updatedAt: candidate.updatedAt.toISOString(),
    };
  }

  private safeContext(value: unknown): string {
    const serialized = JSON.stringify(value ?? null);
    if (Buffer.byteLength(serialized, 'utf8') > 16_384) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Le contexte éditorial dépasse la taille autorisée.',
      );
    }
    return serialized;
  }

  private stringArray(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private stale(): never {
    throw new CodedHttpException(
      HttpStatus.CONFLICT,
      ERROR_CODES.aiGenerationStale,
      'Le contenu a changé. Rechargez-le avant de générer un nouveau brouillon IA.',
    );
  }

  private notFound(): never {
    throw new CodedHttpException(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.aiGenerationNotFound,
      'Brouillon IA introuvable.',
    );
  }
}
