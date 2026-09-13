import type {
  AiGenerationRequest,
  AiGenerationResult,
  AiProvider,
  AiUsage,
} from '@ai-content-os/contracts';
import { AiProviderError } from './ai-errors';

export type MockAiScenario =
  | 'SUCCESS'
  | 'STRUCTURED_SUCCESS'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'MALFORMED_STRUCTURED'
  | 'RETRYABLE_FAILURE'
  | 'NON_RETRYABLE_FAILURE'
  | 'RATE_LIMIT'
  | 'AUTHENTICATION_FAILURE';

export interface MockAiProviderOptions {
  scenario?: MockAiScenario;
  failuresBeforeSuccess?: number;
  usage?: AiUsage;
}

export class MockAiProvider implements AiProvider {
  readonly key = 'mock';
  readonly displayName = 'Fournisseur déterministe (mock)';
  readonly requiresCredentials = false;
  private attempts = 0;

  constructor(private readonly options: MockAiProviderOptions = {}) {}

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    this.attempts += 1;
    if (request.signal?.aborted) throw this.abortError();
    const scenario = this.options.scenario ?? 'SUCCESS';
    if (scenario === 'TIMEOUT') {
      return new Promise((_, reject) => {
        request.signal?.addEventListener('abort', () => reject(this.abortError()), { once: true });
      });
    }
    if (
      scenario === 'RETRYABLE_FAILURE' &&
      this.attempts <= (this.options.failuresBeforeSuccess ?? 1)
    ) {
      throw new AiProviderError(
        'AI_PROVIDER_UNAVAILABLE',
        'UNAVAILABLE',
        'Mock provider is temporarily unavailable.',
        true,
        503,
      );
    }
    if (scenario === 'PROVIDER_ERROR' || scenario === 'NON_RETRYABLE_FAILURE') {
      throw new AiProviderError(
        'AI_PROVIDER_ERROR',
        'UNKNOWN',
        'Mock provider rejected the request.',
        false,
        500,
      );
    }
    if (scenario === 'RATE_LIMIT') {
      throw new AiProviderError(
        'AI_RATE_LIMITED',
        'RATE_LIMIT',
        'Mock provider rate limit reached.',
        true,
        429,
        1,
      );
    }
    if (scenario === 'AUTHENTICATION_FAILURE') {
      throw new AiProviderError(
        'AI_AUTHENTICATION_FAILED',
        'AUTHENTICATION',
        'Mock provider authentication failed.',
        false,
        401,
      );
    }

    const text =
      scenario === 'MALFORMED_STRUCTURED'
        ? '{not-json'
        : scenario === 'STRUCTURED_SUCCESS' || request.outputFormat === 'JSON'
          ? JSON.stringify({ ok: true, value: 'mock-structured-result' })
          : `mock:${request.messages.map((message) => message.content).join('|')}`;
    return {
      text,
      usage: this.options.usage ?? { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      providerRequestId: `mock-request-${this.attempts}`,
    };
  }

  private abortError(): Error {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }
}
