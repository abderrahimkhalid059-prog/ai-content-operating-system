import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '@ai-content-os/config';
import type {
  DiscoveredBloggerBlog,
  IntegrationSummary,
  ProviderConnectionContext,
  ProviderCredential,
  ProviderMode,
  StartBloggerConnectionResult,
} from '@ai-content-os/contracts';
import {
  DatabaseService,
  IntegrationMode,
  Prisma,
  PublishingProviderType,
  WebsiteConnectionStatus,
  WebsitePlatform,
} from '@ai-content-os/database';
import { ProviderError } from '@ai-content-os/integrations';
import { ERROR_CODES } from '@ai-content-os/shared';
import type {
  AuthContext,
  AuthenticatedRequest,
  WorkspaceContext,
} from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { CodedHttpException } from '../../common/errors/coded-http.exception';
import { BloggerProviderFactory } from './blogger-provider.factory';
import type { StartBloggerConnectionDto } from './dto/blogger-integration.dto';

type ConnectionRecord = Awaited<
  ReturnType<DatabaseService['websiteConnection']['findFirstOrThrow']>
>;

@Injectable()
export class BloggerConnectionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService<EnvironmentConfig, true>,
    private readonly providers: BloggerProviderFactory,
    private readonly audit: AuditService,
  ) {}

  systemStatus() {
    return {
      bloggerMode: this.providers.activeMode(),
      publicPublishEnabled: this.config.get('BLOGGER_ALLOW_PUBLIC_PUBLISH', { infer: true }),
      deleteEnabled: this.config.get('BLOGGER_ALLOW_DELETE', { infer: true }),
    };
  }

  async list(workspaceId: string, websiteId: string): Promise<IntegrationSummary[]> {
    await this.requireWebsite(workspaceId, websiteId);
    const connections = await this.database.websiteConnection.findMany({
      where: { workspaceId, websiteId },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map((connection) => this.present(connection));
  }

  async get(workspaceId: string, websiteId: string): Promise<IntegrationSummary> {
    return this.present(await this.requireConnection(workspaceId, websiteId));
  }

  async start(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    input: StartBloggerConnectionDto,
    request: AuthenticatedRequest,
  ): Promise<StartBloggerConnectionResult> {
    const website = await this.requireWebsite(workspace.id, websiteId);
    if (website.platform !== WebsitePlatform.BLOGGER) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.integrationNotConfigured,
        'Ce site n’est pas configuré pour Blogger.',
      );
    }
    const existing = await this.activeConnection(workspace.id, websiteId);
    if (existing && !input.replaceExisting) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.bloggerDuplicateOperation,
        'Une connexion Blogger active existe déjà. Confirmez son remplacement.',
      );
    }
    if (existing) {
      await this.database.websiteConnection.update({
        where: { id: existing.id },
        data: {
          status: WebsiteConnectionStatus.DISCONNECTED,
          revokedAt: new Date(),
          encryptedCredentials: null,
        },
      });
    }
    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const redirectAfter = this.safeRedirect(
      workspace.id,
      websiteId,
      input.redirectAfter ??
        `/espaces/${workspace.id}/sites/${websiteId}/integrations/blogger/selection`,
    );
    const mode = this.providers.activeMode();
    await this.database.oAuthState.create({
      data: {
        workspaceId: workspace.id,
        websiteId,
        userId: actor.userId,
        provider: PublishingProviderType.BLOGGER,
        mode: mode === 'MOCK' ? IntegrationMode.MOCK : IntegrationMode.LIVE,
        stateHash: this.hash(state),
        redirectAfter,
        expiresAt,
      },
    });
    const callbackUrl = this.callbackUrl();
    const authorization = await this.providers.active().getAuthorizationUrl({
      state,
      redirectUri: callbackUrl,
      scopes: this.scopes(),
    });
    await this.audit.record(
      {
        action: 'blogger.connection.started',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'Website',
        targetId: websiteId,
        metadata: { mode },
      },
      request,
    );
    return { authorizationUrl: authorization.url, expiresAt: expiresAt.toISOString() };
  }

  async callback(stateValue: string, code: string, request: AuthenticatedRequest): Promise<string> {
    const stateHash = this.hash(stateValue);
    const state = await this.database.oAuthState.findUnique({ where: { stateHash } });
    if (!state) {
      await this.audit.record(
        {
          action: 'blogger.oauth.callback_failed',
          metadata: { reason: ERROR_CODES.integrationOAuthStateInvalid },
        },
        request,
      );
      this.oauthError(ERROR_CODES.integrationOAuthStateInvalid, 'État OAuth invalide.');
    }
    if (state.consumedAt) {
      this.oauthError(
        ERROR_CODES.integrationOAuthStateReused,
        'Cet état OAuth a déjà été utilisé.',
      );
    }
    if (state.expiresAt <= new Date()) {
      this.oauthError(ERROR_CODES.integrationOAuthStateExpired, 'Cet état OAuth a expiré.');
    }
    const consumed = await this.database.oAuthState.updateMany({
      where: { id: state.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      this.oauthError(ERROR_CODES.integrationOAuthStateReused, 'Cet état OAuth n’est plus valide.');
    }
    try {
      const mode: ProviderMode = state.mode === IntegrationMode.MOCK ? 'MOCK' : 'LIVE';
      const result = await this.providers.forMode(mode).handleAuthorizationCallback({
        state: stateValue,
        code,
        redirectUri: this.callbackUrl(),
      });
      const encryptedCredentials = result.credentials
        ? this.providers.encryption.encrypt(result.credentials)
        : null;
      const connection = await this.database.websiteConnection.create({
        data: {
          workspaceId: state.workspaceId,
          websiteId: state.websiteId,
          provider: PublishingProviderType.BLOGGER,
          mode: state.mode,
          status: WebsiteConnectionStatus.CONNECTED,
          externalAccountId: result.externalAccountId,
          encryptedCredentials,
          credentialKeyVersion: encryptedCredentials
            ? this.config.get('INTEGRATION_ENCRYPTION_KEY_VERSION', { infer: true })
            : null,
          grantedScopes: result.grantedScopes,
          connectedByUserId: state.userId,
          connectedAt: new Date(),
          expiresAt: result.credentials?.expiresAt ? new Date(result.credentials.expiresAt) : null,
          metadata: result.accountEmail ? { accountEmail: result.accountEmail } : Prisma.JsonNull,
        },
      });
      await this.audit.record(
        {
          action: 'blogger.oauth.callback_succeeded',
          actorUserId: state.userId,
          workspaceId: state.workspaceId,
          websiteId: state.websiteId,
          targetType: 'WebsiteConnection',
          targetId: connection.id,
          metadata: { mode },
        },
        request,
      );
      return `${this.config.get('APP_URL', { infer: true })}${state.redirectAfter}?blogger=connected`;
    } catch (error) {
      await this.audit.record(
        {
          action: 'blogger.oauth.callback_failed',
          actorUserId: state.userId,
          workspaceId: state.workspaceId,
          websiteId: state.websiteId,
          metadata: {
            reason: error instanceof ProviderError ? error.code : ERROR_CODES.internal,
          },
        },
        request,
      );
      throw this.providerError(error);
    }
  }

  async sites(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    pageSize?: number,
    pageToken?: string,
    request?: AuthenticatedRequest,
  ): Promise<{ items: DiscoveredBloggerBlog[]; nextPageToken?: string }> {
    const connection = await this.requireConnection(workspace.id, websiteId);
    try {
      const result = await this.providers
        .forMode(this.mode(connection.mode))
        .listSites(this.context(connection, request?.requestId), {
          ...(pageSize ? { pageSize } : {}),
          ...(pageToken ? { pageToken } : {}),
        });
      await this.audit.record(
        {
          action: 'blogger.sites.listed',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'WebsiteConnection',
          targetId: connection.id,
          metadata: { count: result.items.length, hasNextPage: Boolean(result.nextPageToken) },
        },
        request,
      );
      return result;
    } catch (error) {
      await this.markError(connection.id, error);
      throw this.providerError(error);
    }
  }

  async selectSite(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    externalSiteId: string,
    request: AuthenticatedRequest,
  ): Promise<IntegrationSummary> {
    const connection = await this.requireConnection(workspace.id, websiteId);
    try {
      const site = await this.providers
        .forMode(this.mode(connection.mode))
        .getSite(this.context(connection), externalSiteId);
      const duplicate = await this.database.websiteConnection.findFirst({
        where: {
          id: { not: connection.id },
          provider: PublishingProviderType.BLOGGER,
          externalSiteId: site.id,
          revokedAt: null,
          status: {
            in: [
              WebsiteConnectionStatus.CONNECTED,
              WebsiteConnectionStatus.DEGRADED,
              WebsiteConnectionStatus.EXPIRED,
            ],
          },
        },
      });
      if (duplicate) {
        throw new CodedHttpException(
          HttpStatus.CONFLICT,
          ERROR_CODES.bloggerDuplicateOperation,
          'Cette publication Blogger est déjà associée à une connexion active.',
        );
      }
      const updated = await this.database.websiteConnection.update({
        where: { id: connection.id },
        data: {
          externalSiteId: site.id,
          externalSiteName: site.name,
          externalSiteUrl: site.url,
          status: WebsiteConnectionStatus.CONNECTED,
          lastErrorCode: null,
          lastErrorAt: null,
          metadata: { ...this.safeMetadata(connection.metadata), language: site.language },
        },
      });
      await this.audit.record(
        {
          action: 'blogger.site.selected',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'WebsiteConnection',
          targetId: connection.id,
          metadata: { externalSiteId: site.id },
        },
        request,
      );
      return this.present(updated);
    } catch (error) {
      throw this.providerError(error);
    }
  }

  async test(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    request: AuthenticatedRequest,
  ) {
    const connection = await this.requireSelectedConnection(workspace.id, websiteId);
    try {
      const result = await this.providers
        .forMode(this.mode(connection.mode))
        .testConnection(this.context(connection));
      await this.database.websiteConnection.update({
        where: { id: connection.id },
        data: {
          status: WebsiteConnectionStatus.CONNECTED,
          lastTestedAt: new Date(result.checkedAt),
          lastErrorCode: null,
          lastErrorAt: null,
        },
      });
      await this.audit.record(
        {
          action: 'blogger.connection.tested',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'WebsiteConnection',
          targetId: connection.id,
        },
        request,
      );
      return result;
    } catch (error) {
      await this.markError(connection.id, error);
      throw this.providerError(error);
    }
  }

  async refresh(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    request: AuthenticatedRequest,
  ): Promise<IntegrationSummary> {
    const connection = await this.requireConnection(workspace.id, websiteId);
    try {
      const result = await this.providers
        .forMode(this.mode(connection.mode))
        .refreshConnection(this.context(connection));
      const encrypted =
        connection.mode === IntegrationMode.LIVE
          ? this.providers.encryption.encrypt(result.credentials)
          : null;
      const updated = await this.database.websiteConnection.update({
        where: { id: connection.id },
        data: {
          encryptedCredentials: encrypted,
          credentialKeyVersion: encrypted
            ? this.config.get('INTEGRATION_ENCRYPTION_KEY_VERSION', { infer: true })
            : null,
          expiresAt: result.credentials.expiresAt ? new Date(result.credentials.expiresAt) : null,
          status: WebsiteConnectionStatus.CONNECTED,
          lastErrorCode: null,
          lastErrorAt: null,
        },
      });
      await this.audit.record(
        {
          action: 'blogger.connection.refreshed',
          actorUserId: actor.userId,
          workspaceId: workspace.id,
          websiteId,
          targetType: 'WebsiteConnection',
          targetId: connection.id,
        },
        request,
      );
      return this.present(updated);
    } catch (error) {
      await this.markError(connection.id, error);
      throw this.providerError(error);
    }
  }

  async disconnect(
    actor: AuthContext,
    workspace: WorkspaceContext,
    websiteId: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    const connection = await this.requireConnection(workspace.id, websiteId);
    await this.database.websiteConnection.update({
      where: { id: connection.id },
      data: {
        status: WebsiteConnectionStatus.DISCONNECTED,
        revokedAt: new Date(),
        encryptedCredentials: null,
        credentialKeyVersion: null,
      },
    });
    await this.audit.record(
      {
        action: 'blogger.connection.disconnected',
        actorUserId: actor.userId,
        workspaceId: workspace.id,
        websiteId,
        targetType: 'WebsiteConnection',
        targetId: connection.id,
      },
      request,
    );
  }

  async requireConnection(workspaceId: string, websiteId: string): Promise<ConnectionRecord> {
    const connection = await this.activeConnection(workspaceId, websiteId);
    if (!connection) {
      throw new CodedHttpException(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.integrationConnectionNotFound,
        'Connexion Blogger introuvable.',
      );
    }
    return connection;
  }

  async requireSelectedConnection(
    workspaceId: string,
    websiteId: string,
  ): Promise<ConnectionRecord> {
    const connection = await this.requireConnection(workspaceId, websiteId);
    if (!connection.externalSiteId) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.integrationNotConfigured,
        'Sélectionnez d’abord une publication Blogger.',
      );
    }
    return connection;
  }

  async selectedConnectionOrNull(
    workspaceId: string,
    websiteId: string,
  ): Promise<ConnectionRecord | null> {
    await this.requireWebsite(workspaceId, websiteId);
    const connection = await this.activeConnection(workspaceId, websiteId);
    return connection?.externalSiteId ? connection : null;
  }

  context(connection: ConnectionRecord, correlationId?: string): ProviderConnectionContext {
    return {
      connectionId: connection.id,
      mode: this.mode(connection.mode),
      workspaceId: connection.workspaceId,
      websiteId: connection.websiteId,
      ...(correlationId ? { correlationId } : {}),
      ...(connection.externalAccountId ? { externalAccountId: connection.externalAccountId } : {}),
      ...(connection.externalSiteId ? { externalSiteId: connection.externalSiteId } : {}),
      ...(connection.encryptedCredentials && connection.credentialKeyVersion
        ? {
            credentials: this.decryptCredentials(
              connection.encryptedCredentials,
              connection.credentialKeyVersion,
            ),
          }
        : {}),
    };
  }

  recordProviderError(connectionId: string, error: unknown): Promise<void> {
    return this.markError(connectionId, error);
  }

  present(connection: ConnectionRecord): IntegrationSummary {
    const scopes = Array.isArray(connection.grantedScopes)
      ? connection.grantedScopes.filter((value): value is string => typeof value === 'string')
      : [];
    return {
      id: connection.id,
      workspaceId: connection.workspaceId,
      websiteId: connection.websiteId,
      provider: connection.provider,
      mode: this.mode(connection.mode),
      status: connection.status,
      ...(connection.externalAccountId ? { externalAccountId: connection.externalAccountId } : {}),
      ...(connection.externalSiteId ? { externalSiteId: connection.externalSiteId } : {}),
      ...(connection.externalSiteName ? { externalSiteName: connection.externalSiteName } : {}),
      ...(connection.externalSiteUrl ? { externalSiteUrl: connection.externalSiteUrl } : {}),
      grantedScopes: scopes,
      ...(connection.connectedAt ? { connectedAt: connection.connectedAt.toISOString() } : {}),
      ...(connection.lastTestedAt ? { lastTestedAt: connection.lastTestedAt.toISOString() } : {}),
      ...(connection.lastSuccessfulSyncAt
        ? { lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt.toISOString() }
        : {}),
      ...(connection.expiresAt ? { expiresAt: connection.expiresAt.toISOString() } : {}),
      ...(connection.lastErrorCode ? { lastErrorCode: connection.lastErrorCode } : {}),
      ...(connection.lastErrorAt ? { lastErrorAt: connection.lastErrorAt.toISOString() } : {}),
      publicPublishEnabled: this.config.get('BLOGGER_ALLOW_PUBLIC_PUBLISH', { infer: true }),
      deleteEnabled: this.config.get('BLOGGER_ALLOW_DELETE', { infer: true }),
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    };
  }

  private async requireWebsite(workspaceId: string, websiteId: string) {
    const website = await this.database.website.findFirst({
      where: { id: websiteId, workspaceId, deletedAt: null },
    });
    if (!website) {
      throw new CodedHttpException(HttpStatus.NOT_FOUND, ERROR_CODES.notFound, 'Site introuvable.');
    }
    return website;
  }

  private activeConnection(workspaceId: string, websiteId: string) {
    return this.database.websiteConnection.findFirst({
      where: {
        workspaceId,
        websiteId,
        provider: PublishingProviderType.BLOGGER,
        revokedAt: null,
        status: {
          in: [
            WebsiteConnectionStatus.PENDING,
            WebsiteConnectionStatus.CONNECTED,
            WebsiteConnectionStatus.DEGRADED,
            WebsiteConnectionStatus.EXPIRED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private mode(mode: IntegrationMode): ProviderMode {
    return mode === IntegrationMode.MOCK ? 'MOCK' : 'LIVE';
  }

  private scopes(): string[] {
    return this.config.get('GOOGLE_BLOGGER_SCOPES', { infer: true }).split(/\s+/).filter(Boolean);
  }

  private callbackUrl(): string {
    const configured = this.config.get('GOOGLE_BLOGGER_REDIRECT_URI', { infer: true });
    if (configured) return configured;
    const api = new URL(this.config.get('API_URL', { infer: true }));
    return `${api.origin}/api/v1/integrations/blogger/callback`;
  }

  private safeRedirect(workspaceId: string, websiteId: string, redirectAfter: string): string {
    const root = `/espaces/${workspaceId}/sites/${websiteId}/integrations/blogger`;
    if (redirectAfter !== root && redirectAfter !== `${root}/selection`) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        'Destination de retour non autorisée.',
      );
    }
    return redirectAfter;
  }

  private decryptCredentials(ciphertext: string, keyVersion: string): ProviderCredential {
    try {
      return this.providers.encryption.decrypt<ProviderCredential>(ciphertext, keyVersion);
    } catch {
      throw new CodedHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.integrationCredentialDecryptionFailed,
        'Les identifiants de cette connexion ne peuvent pas être déchiffrés.',
      );
    }
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private safeMetadata(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : {};
  }

  private async markError(connectionId: string, error: unknown): Promise<void> {
    const code = error instanceof ProviderError ? error.code : ERROR_CODES.internal;
    const reauthorizationRequired =
      code === ERROR_CODES.integrationConnectionExpired ||
      code === ERROR_CODES.bloggerAccountUnauthorized ||
      (code === ERROR_CODES.bloggerTokenRefreshFailed &&
        error instanceof ProviderError &&
        !error.retryable);
    await this.database.websiteConnection.update({
      where: { id: connectionId },
      data: {
        status: reauthorizationRequired
          ? WebsiteConnectionStatus.EXPIRED
          : WebsiteConnectionStatus.DEGRADED,
        lastErrorCode: code,
        lastErrorAt: new Date(),
      },
    });
  }

  providerError(error: unknown): CodedHttpException {
    if (error instanceof CodedHttpException) return error;
    if (!(error instanceof ProviderError)) {
      return new CodedHttpException(
        HttpStatus.BAD_GATEWAY,
        ERROR_CODES.bloggerUpstreamUnavailable,
        'Le fournisseur Blogger est temporairement indisponible.',
      );
    }
    const status =
      error.code === ERROR_CODES.bloggerPermissionDenied
        ? HttpStatus.FORBIDDEN
        : error.code === ERROR_CODES.bloggerBlogNotFound ||
            error.code === ERROR_CODES.bloggerPostNotFound
          ? HttpStatus.NOT_FOUND
          : error.code === ERROR_CODES.bloggerRateLimited
            ? HttpStatus.TOO_MANY_REQUESTS
            : error.code === ERROR_CODES.integrationConnectionExpired ||
                error.code === ERROR_CODES.bloggerAccountUnauthorized
              ? HttpStatus.UNAUTHORIZED
              : HttpStatus.BAD_GATEWAY;
    return new CodedHttpException(status, error.code, error.message);
  }

  private oauthError(code: string, message: string): never {
    throw new CodedHttpException(HttpStatus.BAD_REQUEST, code, message);
  }
}
