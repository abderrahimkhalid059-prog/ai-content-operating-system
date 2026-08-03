export type ProviderErrorCode =
  | 'INTEGRATION_NOT_CONFIGURED'
  | 'INTEGRATION_CONNECTION_EXPIRED'
  | 'BLOGGER_ACCOUNT_UNAUTHORIZED'
  | 'BLOGGER_PERMISSION_DENIED'
  | 'BLOGGER_BLOG_NOT_FOUND'
  | 'BLOGGER_POST_NOT_FOUND'
  | 'BLOGGER_RATE_LIMITED'
  | 'BLOGGER_UPSTREAM_UNAVAILABLE'
  | 'BLOGGER_TOKEN_REFRESH_FAILED';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
