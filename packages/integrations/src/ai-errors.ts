import type { AiErrorCategory } from '@ai-content-os/contracts';

export type AiProviderErrorCode =
  | 'AI_AUTHENTICATION_FAILED'
  | 'AI_RATE_LIMITED'
  | 'AI_INVALID_REQUEST'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_MALFORMED_RESPONSE'
  | 'AI_PROVIDER_ERROR';

export class AiProviderError extends Error {
  retryCount = 0;

  constructor(
    readonly code: AiProviderErrorCode,
    readonly category: AiErrorCategory,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export function normalizeAiProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new AiProviderError('AI_TIMEOUT', 'TIMEOUT', 'AI provider request timed out.', true);
  }
  return new AiProviderError('AI_PROVIDER_ERROR', 'UNKNOWN', 'AI provider request failed.', false);
}
