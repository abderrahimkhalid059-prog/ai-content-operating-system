import { z } from 'zod';

const optionalPassword = z
  .string()
  .optional()
  .transform((value) => value || undefined);
const optionalString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const duration = z.string().regex(/^\d+(ms|s|m|h|d)$/, 'Use a duration such as 15m or 7d.');
const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    API_PORT: z.coerce.number().int().min(1).max(65_535),
    WEB_PORT: z.coerce.number().int().min(1).max(65_535),
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    REDIS_HOST: z.string().min(1),
    REDIS_PORT: z.coerce.number().int().min(1).max(65_535),
    REDIS_PASSWORD: optionalPassword,
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: duration,
    REFRESH_TOKEN_SECRET: z.string().min(32),
    REFRESH_TOKEN_TTL: duration,
    AUTH_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    AUTH_COOKIE_SECURE: booleanFromEnvironment,
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(12).max(128),
    LOGIN_RATE_LIMIT_WINDOW: duration,
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000),
    SEED_OWNER_EMAIL: z.string().email().optional(),
    SEED_OWNER_PASSWORD: optionalPassword,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    CORS_ORIGINS: z.string().min(1),
    APP_URL: z.string().url(),
    API_URL: z.string().url(),
    BLOGGER_MODE: z.enum(['mock', 'live']).optional(),
    GOOGLE_BLOGGER_CLIENT_ID: optionalString,
    GOOGLE_BLOGGER_CLIENT_SECRET: optionalString,
    GOOGLE_BLOGGER_REDIRECT_URI: optionalString,
    GOOGLE_BLOGGER_SCOPES: z.string().min(1).default('https://www.googleapis.com/auth/blogger'),
    BLOGGER_API_BASE_URL: z.string().url().default('https://www.googleapis.com/blogger/v3'),
    BLOGGER_OAUTH_AUTH_URL: z
      .string()
      .url()
      .default('https://accounts.google.com/o/oauth2/v2/auth'),
    BLOGGER_OAUTH_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
    INTEGRATION_ENCRYPTION_KEY: optionalString,
    INTEGRATION_ENCRYPTION_KEY_VERSION: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,50}$/)
      .default('v1'),
    BLOGGER_ALLOW_PUBLIC_PUBLISH: booleanFromEnvironment.default(false),
    BLOGGER_ALLOW_DELETE: booleanFromEnvironment.default(false),
    BLOGGER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    BLOGGER_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    BLOGGER_SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    SEED_MOCK_BLOGGER_CONNECTION: booleanFromEnvironment.default(false),
  })
  .superRefine((config, context) => {
    if (config.JWT_ACCESS_SECRET === config.REFRESH_TOKEN_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_SECRET'],
        message: 'Access and refresh secrets must be different.',
      });
    }
    if (config.NODE_ENV === 'production' && !config.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'Secure refresh cookies are required in production.',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      [config.JWT_ACCESS_SECRET, config.REFRESH_TOKEN_SECRET].some((secret) =>
        /development-only|test-/i.test(secret),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'Production requires deployment-managed authentication secrets.',
      });
    }
    if (config.NODE_ENV === 'production' && !config.BLOGGER_MODE) {
      context.addIssue({
        code: 'custom',
        path: ['BLOGGER_MODE'],
        message: 'Production must explicitly select mock or live Blogger mode.',
      });
    }
    const bloggerMode = config.BLOGGER_MODE ?? 'mock';
    if (
      bloggerMode === 'live' &&
      (!config.GOOGLE_BLOGGER_CLIENT_ID ||
        !config.GOOGLE_BLOGGER_CLIENT_SECRET ||
        !config.GOOGLE_BLOGGER_REDIRECT_URI)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_BLOGGER_CLIENT_ID'],
        message: 'Live Blogger mode requires client ID, client secret, and redirect URI.',
      });
    }
    if (config.GOOGLE_BLOGGER_REDIRECT_URI) {
      const redirect = z.string().url().safeParse(config.GOOGLE_BLOGGER_REDIRECT_URI);
      if (!redirect.success) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_BLOGGER_REDIRECT_URI'],
          message: 'Use an absolute Google OAuth redirect URI.',
        });
      }
    }
    if (config.INTEGRATION_ENCRYPTION_KEY) {
      let keyLength = 0;
      try {
        keyLength = Buffer.from(config.INTEGRATION_ENCRYPTION_KEY, 'base64').length;
      } catch {
        keyLength = 0;
      }
      if (keyLength !== 32) {
        context.addIssue({
          code: 'custom',
          path: ['INTEGRATION_ENCRYPTION_KEY'],
          message: 'Integration encryption key must be a base64-encoded 32-byte key.',
        });
      }
    }
    if (config.NODE_ENV === 'production' && !config.INTEGRATION_ENCRYPTION_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['INTEGRATION_ENCRYPTION_KEY'],
        message: 'Production requires an integration encryption key.',
      });
    }
  })
  .transform((config) => ({ ...config, BLOGGER_MODE: config.BLOGGER_MODE ?? ('mock' as const) }));

export type EnvironmentConfig = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): EnvironmentConfig {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  return result.data;
}

export const parseCorsOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const durationUnits = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

export function durationToMilliseconds(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof durationUnits;
  return amount * durationUnits[unit];
}

export const redactEnvironment = (config: EnvironmentConfig): Record<string, unknown> => ({
  ...config,
  DATABASE_URL: '[REDACTED]',
  REDIS_PASSWORD: config.REDIS_PASSWORD ? '[REDACTED]' : undefined,
  JWT_ACCESS_SECRET: '[REDACTED]',
  REFRESH_TOKEN_SECRET: '[REDACTED]',
  SEED_OWNER_PASSWORD: config.SEED_OWNER_PASSWORD ? '[REDACTED]' : undefined,
  GOOGLE_BLOGGER_CLIENT_SECRET: config.GOOGLE_BLOGGER_CLIENT_SECRET ? '[REDACTED]' : undefined,
  INTEGRATION_ENCRYPTION_KEY: config.INTEGRATION_ENCRYPTION_KEY ? '[REDACTED]' : undefined,
});
