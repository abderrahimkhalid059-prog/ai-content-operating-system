import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type {
  AiConfigurationSummary,
  AiProviderDescriptor,
  AiProviderTestResult,
  AiRunSummary,
  ResolvedAiConfiguration,
} from '@ai-content-os/contracts';
import {
  AiConfigurationScope,
  AiErrorCategory,
  AiRunStatus,
  DatabaseService,
} from '@ai-content-os/database';
import {
  AiProviderError,
  executeAiRequest,
  normalizeAiProviderError,
  requireSafeExecutionPolicy,
} from '@ai-content-os/integrations';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import type { AiRunsQueryDto, AiScopeQueryDto, UpsertAiConfigurationDto } from './dto/ai.dto';
import { AiProviderFactory } from './ai-provider.factory';

type ConfigurationRow = Awaited<ReturnType<AiService['findConfiguration']>>;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly factory: AiProviderFactory,
    private readonly audit: AuditService,
  ) {}

  listProviders(): AiProviderDescriptor[] {
    return this.factory.providers.list();
  }

  async listConfigurations(workspaceId: string): Promise<AiConfigurationSummary[]> {
    const configurations = await this.database.aiConfiguration.findMany({
      where: { workspaceId },
      orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
    });
    return configurations.map((configuration) => this.presentConfiguration(configuration));
  }

  async upsertConfiguration(
    actor: AuthContext,
    workspace: WorkspaceContext,
    input: UpsertAiConfigurationDto,
    request: AuthenticatedRequest,
  ): Promise<AiConfigurationSummary> {
    if (!this.factory.providers.has(input.providerKey)) {
      this.invalid('Le fournisseur IA demandé n’est pas disponible.');
    }
    const scope = await this.validateScope(workspace.id, input);
    this.validatePricing(input);
    if (input.credential && input.removeCredential) {
      this.invalid('Un identifiant ne peut pas être remplacé et supprimé simultanément.');
    }
    requireSafeExecutionPolicy({
      timeoutMs: input.timeoutMs ?? 10_000,
      maxRetries: input.maxRetries ?? 2,
    });
    const current = await this.database.aiConfiguration.findUnique({
      where: {
        workspaceId_scope_scopeKey: {
          workspaceId: workspace.id,
          scope: input.scope,
          scopeKey: scope.scopeKey,
        },
      },
    });
    const encryptedCredentials = input.credential
      ? this.factory.encryption.encrypt({ credential: input.credential })
      : input.removeCredential
        ? null
        : current?.encryptedCredentials;
    const credentialKeyVersion = input.credential
      ? this.factory.encryption.keyVersion
      : input.removeCredential
        ? null
        : current?.credentialKeyVersion;
    const credentialHint = input.credential
      ? `••••${input.credential.slice(-4)}`
      : input.removeCredential
        ? null
        : current?.credentialHint;
    const data = {
      workspaceId: workspace.id,
      websiteId: scope.websiteId,
      contentProfileId: scope.contentProfileId,
      scope: input.scope,
      scopeKey: scope.scopeKey,
      providerKey: input.providerKey.trim().toLowerCase(),
      model: input.model.trim(),
      encryptedCredentials: encryptedCredentials ?? null,
      credentialKeyVersion: credentialKeyVersion ?? null,
      credentialHint: credentialHint ?? null,
      timeoutMs: input.timeoutMs ?? 10_000,
      maxRetries: input.maxRetries ?? 2,
      temperature: input.temperature ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
      monthlyTokenLimit: input.monthlyTokenLimit ?? null,
      pricingCurrency: input.pricingCurrency?.toUpperCase() ?? null,
      inputCostPerMillionMicros: input.inputCostPerMillionMicros ?? null,
      outputCostPerMillionMicros: input.outputCostPerMillionMicros ?? null,
      isEnabled: input.isEnabled ?? true,
    };
    const configuration = await this.database.aiConfiguration.upsert({
      where: {
        workspaceId_scope_scopeKey: {
          workspaceId: workspace.id,
          scope: input.scope,
          scopeKey: scope.scopeKey,
        },
      },
      create: data,
      update: data,
    });
    const changed: string[] = [];
    if (!current || current.providerKey !== configuration.providerKey) changed.push('provider');
    if (!current || current.model !== configuration.model) changed.push('model');
    if (input.credential) changed.push('credential_replaced');
    if (input.removeCredential && current?.encryptedCredentials) changed.push('credential_removed');
    changed.push('settings');
    await this.audit.record(
      {
        action: current ? 'ai.configuration.updated' : 'ai.configuration.created',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        ...(scope.websiteId ? { websiteId: scope.websiteId } : {}),
        targetType: 'AiConfiguration',
        targetId: configuration.id,
        metadata: {
          scope: configuration.scope,
          providerKey: configuration.providerKey,
          model: configuration.model,
          changedFields: changed.join(','),
          hasCredential: Boolean(configuration.encryptedCredentials),
        },
      },
      request,
    );
    return this.presentConfiguration(configuration);
  }

  async resolve(workspaceId: string, query: AiScopeQueryDto): Promise<ResolvedAiConfiguration> {
    await this.validateQueryScope(workspaceId, query);
    const candidates = await this.database.aiConfiguration.findMany({
      where: {
        workspaceId,
        isEnabled: true,
        OR: [
          ...(query.contentProfileId
            ? [
                {
                  scope: AiConfigurationScope.CONTENT_PROFILE,
                  scopeKey: query.contentProfileId,
                },
              ]
            : []),
          ...(query.websiteId
            ? [{ scope: AiConfigurationScope.WEBSITE, scopeKey: query.websiteId }]
            : []),
          { scope: AiConfigurationScope.WORKSPACE, scopeKey: workspaceId },
        ],
      },
    });
    const configuration =
      candidates.find((item) => item.scope === AiConfigurationScope.CONTENT_PROFILE) ??
      candidates.find((item) => item.scope === AiConfigurationScope.WEBSITE) ??
      candidates.find((item) => item.scope === AiConfigurationScope.WORKSPACE);
    if (!configuration) {
      return {
        workspaceId,
        scope: 'WORKSPACE',
        providerKey: 'mock',
        model: 'mock-v1',
        hasCredential: false,
        timeoutMs: 10_000,
        maxRetries: 2,
        isEnabled: true,
        source: 'SYSTEM',
      };
    }
    return this.presentConfiguration(configuration);
  }

  async testConfiguration(
    actor: AuthContext,
    workspace: WorkspaceContext,
    configurationId: string,
    request: AuthenticatedRequest,
  ): Promise<AiProviderTestResult> {
    const configuration = await this.findConfiguration(workspace.id, configurationId);
    if (!configuration.isEnabled) this.invalid('Cette configuration IA est désactivée.');
    await this.enforceMonthlyLimit(configuration);
    const provider = this.factory.providers.get(configuration.providerKey);
    let credential: string | undefined;
    if (configuration.encryptedCredentials && configuration.credentialKeyVersion) {
      try {
        credential = this.factory.encryption.decrypt<{ credential: string }>(
          configuration.encryptedCredentials,
          configuration.credentialKeyVersion,
        ).credential;
      } catch {
        throw new CodedHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          ERROR_CODES.aiCredentialUnavailable,
          'Les identifiants du fournisseur IA ne peuvent pas être utilisés.',
        );
      }
    }
    if (provider.requiresCredentials && !credential) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.aiCredentialUnavailable,
        'Un identifiant fournisseur est requis.',
      );
    }
    const prompt = this.factory.prompts.render('infrastructure.configuration-probe', 1, {
      provider: configuration.providerKey,
      model: configuration.model,
    });
    const idempotencyKey = `configuration-test:${randomUUID()}`;
    const correlationId = request.requestId ?? randomUUID();
    const run = await this.database.aiRun.create({
      data: {
        workspaceId: workspace.id,
        websiteId: configuration.websiteId,
        contentProfileId: configuration.contentProfileId,
        configurationId: configuration.id,
        idempotencyKey,
        providerKey: configuration.providerKey,
        model: configuration.model,
        operation: 'CONFIGURATION_TEST',
        promptIdentifier: prompt.identifier,
        promptVersion: prompt.version,
        correlationId,
      },
    });
    try {
      const execution = await executeAiRequest(
        provider,
        {
          model: configuration.model,
          ...(prompt.systemInstructions ? { systemInstructions: prompt.systemInstructions } : {}),
          messages: [{ role: 'USER', content: prompt.userPrompt }],
          outputFormat: 'TEXT',
          parameters: {
            ...(configuration.temperature !== null
              ? { temperature: configuration.temperature }
              : {}),
            ...(configuration.maxOutputTokens !== null
              ? { maxOutputTokens: configuration.maxOutputTokens }
              : {}),
          },
        },
        { timeoutMs: configuration.timeoutMs, maxRetries: configuration.maxRetries },
        { ...(credential ? { credential } : {}), correlationId },
      );
      const usage = execution.result.usage;
      const cost = this.estimateCost(configuration, usage?.inputTokens, usage?.outputTokens);
      const completed = await this.database.aiRun.update({
        where: { id: run.id },
        data: {
          status: AiRunStatus.COMPLETED,
          completedAt: new Date(),
          latencyMs: execution.latencyMs,
          retryCount: execution.retryCount,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          estimatedCostMicros: cost,
          costCurrency: cost === null ? null : configuration.pricingCurrency,
        },
      });
      this.logger.log({
        operation: 'CONFIGURATION_TEST',
        providerKey: configuration.providerKey,
        model: configuration.model,
        correlationId,
        retryCount: execution.retryCount,
        status: 'COMPLETED',
      });
      await this.audit.record(
        {
          action: 'ai.configuration.tested',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          ...(configuration.websiteId ? { websiteId: configuration.websiteId } : {}),
          targetType: 'AiConfiguration',
          targetId: configuration.id,
          metadata: { succeeded: true, providerKey: configuration.providerKey },
        },
        request,
      );
      return { ok: true, run: this.presentRun(completed) };
    } catch (error) {
      const normalized = normalizeAiProviderError(error);
      await this.database.aiRun.update({
        where: { id: run.id },
        data: {
          status: AiRunStatus.FAILED,
          completedAt: new Date(),
          retryCount: normalized.retryCount,
          errorCategory: normalized.category,
          errorCode: normalized.code,
        },
      });
      this.logger.warn({
        operation: 'CONFIGURATION_TEST',
        providerKey: configuration.providerKey,
        model: configuration.model,
        correlationId,
        retryCount: normalized.retryCount,
        errorCategory: normalized.category,
        errorCode: normalized.code,
        status: 'FAILED',
      });
      await this.audit.record(
        {
          action: 'ai.configuration.tested',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          ...(configuration.websiteId ? { websiteId: configuration.websiteId } : {}),
          targetType: 'AiConfiguration',
          targetId: configuration.id,
          metadata: {
            succeeded: false,
            providerKey: configuration.providerKey,
            errorCode: normalized.code,
          },
        },
        request,
      );
      throw this.providerException(normalized);
    }
  }

  async listRuns(workspaceId: string, query: AiRunsQueryDto): Promise<AiRunSummary[]> {
    await this.validateQueryScope(workspaceId, query);
    const runs = await this.database.aiRun.findMany({
      where: {
        workspaceId,
        ...(query.websiteId ? { websiteId: query.websiteId } : {}),
        ...(query.contentProfileId ? { contentProfileId: query.contentProfileId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: query.limit ?? 20,
    });
    return runs.map((run) => this.presentRun(run));
  }

  private async validateScope(workspaceId: string, input: UpsertAiConfigurationDto) {
    if (input.scope === AiConfigurationScope.WORKSPACE) {
      if (input.websiteId || input.contentProfileId)
        this.invalid('La portée espace refuse les identifiants site ou profil.');
      return { scopeKey: workspaceId, websiteId: null, contentProfileId: null };
    }
    if (!input.websiteId) this.invalid('Le site est requis pour cette portée.');
    const website = await this.database.website.findFirst({
      where: { id: input.websiteId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!website) this.notFound();
    if (input.scope === AiConfigurationScope.WEBSITE) {
      if (input.contentProfileId) this.invalid('La portée site refuse un identifiant de profil.');
      return { scopeKey: input.websiteId, websiteId: input.websiteId, contentProfileId: null };
    }
    if (!input.contentProfileId) this.invalid('Le profil éditorial est requis.');
    const profile = await this.database.contentProfile.findFirst({
      where: { id: input.contentProfileId, workspaceId, websiteId: input.websiteId },
      select: { id: true },
    });
    if (!profile) this.notFound();
    return {
      scopeKey: input.contentProfileId,
      websiteId: input.websiteId,
      contentProfileId: input.contentProfileId,
    };
  }

  private async validateQueryScope(workspaceId: string, query: AiScopeQueryDto): Promise<void> {
    if (query.contentProfileId && !query.websiteId)
      this.invalid('Le site est requis avec un profil éditorial.');
    if (!query.websiteId) return;
    const website = await this.database.website.findFirst({
      where: { id: query.websiteId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!website) this.notFound();
    if (query.contentProfileId) {
      const profile = await this.database.contentProfile.findFirst({
        where: { id: query.contentProfileId, workspaceId, websiteId: query.websiteId },
        select: { id: true },
      });
      if (!profile) this.notFound();
    }
  }

  private validatePricing(input: UpsertAiConfigurationDto): void {
    const values = [
      input.pricingCurrency,
      input.inputCostPerMillionMicros,
      input.outputCostPerMillionMicros,
    ];
    const supplied = values.filter((value) => value !== undefined).length;
    if (supplied !== 0 && supplied !== values.length) {
      this.invalid('La devise et les deux tarifs doivent être fournis ensemble.');
    }
    if (input.pricingCurrency && !/^[A-Za-z]{3}$/.test(input.pricingCurrency)) {
      this.invalid('La devise doit utiliser un code ISO alphabétique à trois lettres.');
    }
  }

  private async enforceMonthlyLimit(configuration: ConfigurationRow): Promise<void> {
    if (configuration.monthlyTokenLimit === null) return;
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const usage = await this.database.aiRun.aggregate({
      where: {
        configurationId: configuration.id,
        workspaceId: configuration.workspaceId,
        status: AiRunStatus.COMPLETED,
        startedAt: { gte: start },
      },
      _sum: { totalTokens: true },
    });
    if ((usage._sum.totalTokens ?? 0) >= configuration.monthlyTokenLimit) {
      throw new CodedHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        ERROR_CODES.aiMonthlyLimitReached,
        'La limite mensuelle de jetons IA est atteinte.',
      );
    }
  }

  private estimateCost(
    configuration: ConfigurationRow,
    inputTokens?: number,
    outputTokens?: number,
  ): number | null {
    if (
      inputTokens === undefined ||
      outputTokens === undefined ||
      configuration.inputCostPerMillionMicros === null ||
      configuration.outputCostPerMillionMicros === null ||
      !configuration.pricingCurrency
    ) {
      return null;
    }
    return Math.round(
      (inputTokens * configuration.inputCostPerMillionMicros +
        outputTokens * configuration.outputCostPerMillionMicros) /
        1_000_000,
    );
  }

  private async findConfiguration(workspaceId: string, id: string) {
    const configuration = await this.database.aiConfiguration.findFirst({
      where: { id, workspaceId },
    });
    if (!configuration) this.notFound();
    return configuration;
  }

  private presentConfiguration(configuration: ConfigurationRow): AiConfigurationSummary {
    return {
      id: configuration.id,
      workspaceId: configuration.workspaceId,
      ...(configuration.websiteId ? { websiteId: configuration.websiteId } : {}),
      ...(configuration.contentProfileId
        ? { contentProfileId: configuration.contentProfileId }
        : {}),
      scope: configuration.scope,
      providerKey: configuration.providerKey,
      model: configuration.model,
      hasCredential: Boolean(configuration.encryptedCredentials),
      ...(configuration.credentialHint ? { credentialHint: configuration.credentialHint } : {}),
      timeoutMs: configuration.timeoutMs,
      maxRetries: configuration.maxRetries,
      ...(configuration.temperature !== null ? { temperature: configuration.temperature } : {}),
      ...(configuration.maxOutputTokens !== null
        ? { maxOutputTokens: configuration.maxOutputTokens }
        : {}),
      ...(configuration.monthlyTokenLimit !== null
        ? { monthlyTokenLimit: configuration.monthlyTokenLimit }
        : {}),
      ...(configuration.pricingCurrency &&
      configuration.inputCostPerMillionMicros !== null &&
      configuration.outputCostPerMillionMicros !== null
        ? {
            pricing: {
              currency: configuration.pricingCurrency,
              inputMicrosPerMillionTokens: configuration.inputCostPerMillionMicros,
              outputMicrosPerMillionTokens: configuration.outputCostPerMillionMicros,
            },
          }
        : {}),
      isEnabled: configuration.isEnabled,
      source: configuration.scope,
      createdAt: configuration.createdAt.toISOString(),
      updatedAt: configuration.updatedAt.toISOString(),
    };
  }

  private presentRun(run: {
    id: string;
    workspaceId: string;
    websiteId: string | null;
    contentProfileId: string | null;
    configurationId: string | null;
    providerKey: string;
    model: string;
    operation: string;
    promptIdentifier: string;
    promptVersion: number;
    correlationId: string;
    status: AiRunStatus;
    startedAt: Date;
    completedAt: Date | null;
    latencyMs: number | null;
    retryCount: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCostMicros: number | null;
    costCurrency: string | null;
    errorCategory: AiErrorCategory | null;
    errorCode: string | null;
  }): AiRunSummary {
    return {
      id: run.id,
      workspaceId: run.workspaceId,
      ...(run.websiteId ? { websiteId: run.websiteId } : {}),
      ...(run.contentProfileId ? { contentProfileId: run.contentProfileId } : {}),
      ...(run.configurationId ? { configurationId: run.configurationId } : {}),
      providerKey: run.providerKey,
      model: run.model,
      operation: run.operation,
      promptIdentifier: run.promptIdentifier,
      promptVersion: run.promptVersion,
      correlationId: run.correlationId,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
      ...(run.latencyMs !== null ? { latencyMs: run.latencyMs } : {}),
      retryCount: run.retryCount,
      ...(run.inputTokens !== null ? { inputTokens: run.inputTokens } : {}),
      ...(run.outputTokens !== null ? { outputTokens: run.outputTokens } : {}),
      ...(run.totalTokens !== null ? { totalTokens: run.totalTokens } : {}),
      ...(run.estimatedCostMicros !== null ? { estimatedCostMicros: run.estimatedCostMicros } : {}),
      ...(run.costCurrency ? { costCurrency: run.costCurrency } : {}),
      ...(run.errorCategory ? { errorCategory: run.errorCategory } : {}),
      ...(run.errorCode ? { errorCode: run.errorCode } : {}),
    };
  }

  private providerException(error: AiProviderError): CodedHttpException {
    const status =
      error.category === 'AUTHENTICATION'
        ? HttpStatus.UNAUTHORIZED
        : error.category === 'RATE_LIMIT'
          ? HttpStatus.TOO_MANY_REQUESTS
          : error.category === 'INVALID_REQUEST'
            ? HttpStatus.BAD_REQUEST
            : error.category === 'TIMEOUT'
              ? HttpStatus.GATEWAY_TIMEOUT
              : HttpStatus.BAD_GATEWAY;
    return new CodedHttpException(
      status,
      error.code || ERROR_CODES.aiProviderFailed,
      'Le test du fournisseur IA a échoué. Consultez le journal des exécutions.',
    );
  }

  private invalid(message: string): never {
    throw new CodedHttpException(
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.aiConfigurationInvalid,
      message,
    );
  }

  private notFound(): never {
    throw new CodedHttpException(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.aiConfigurationNotFound,
      'Configuration IA introuvable.',
    );
  }
}
