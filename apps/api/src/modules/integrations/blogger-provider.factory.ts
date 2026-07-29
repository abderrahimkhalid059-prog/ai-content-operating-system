import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '@ai-content-os/config';
import type { ProviderMode, PublishingProvider } from '@ai-content-os/contracts';
import {
  CredentialEncryption,
  LiveBloggerProvider,
  MockBloggerProvider,
} from '@ai-content-os/integrations';
import { ERROR_CODES } from '@ai-content-os/shared';
import { CodedHttpException } from '../../common/errors/coded-http.exception';

@Injectable()
export class BloggerProviderFactory {
  private readonly mock = new MockBloggerProvider();
  private readonly logger = new Logger(BloggerProviderFactory.name);
  readonly encryption: CredentialEncryption;

  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {
    this.encryption = new CredentialEncryption(
      this.config.get('INTEGRATION_ENCRYPTION_KEY', { infer: true }),
      this.config.get('INTEGRATION_ENCRYPTION_KEY_VERSION', { infer: true }),
    );
  }

  activeMode(): ProviderMode {
    return this.config.get('BLOGGER_MODE', { infer: true }) === 'live' ? 'LIVE' : 'MOCK';
  }

  active(): PublishingProvider {
    return this.forMode(this.activeMode());
  }

  forMode(mode: ProviderMode): PublishingProvider {
    if (mode !== this.activeMode()) {
      throw new CodedHttpException(
        HttpStatus.CONFLICT,
        ERROR_CODES.integrationModeInvalid,
        'Le mode de cette connexion ne correspond pas au mode Blogger actif.',
      );
    }
    if (mode === 'MOCK') return this.mock;
    return new LiveBloggerProvider(
      {
        clientId: this.config.get('GOOGLE_BLOGGER_CLIENT_ID', { infer: true }) ?? '',
        clientSecret: this.config.get('GOOGLE_BLOGGER_CLIENT_SECRET', { infer: true }) ?? '',
        authorizationUrl: this.config.get('BLOGGER_OAUTH_AUTH_URL', { infer: true }),
        tokenUrl: this.config.get('BLOGGER_OAUTH_TOKEN_URL', { infer: true }),
        apiBaseUrl: this.config.get('BLOGGER_API_BASE_URL', { infer: true }),
        timeoutMs: this.config.get('BLOGGER_REQUEST_TIMEOUT_MS', { infer: true }),
      },
      undefined,
      (diagnostic) => this.logger.log(diagnostic),
    );
  }
}
