import { z } from 'zod';

const optionalPassword = z
  .string()
  .optional()
  .transform((value) => value || undefined);

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  API_PORT: z.coerce.number().int().min(1).max(65_535),
  WEB_PORT: z.coerce.number().int().min(1).max(65_535),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535),
  REDIS_PASSWORD: optionalPassword,
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  CORS_ORIGINS: z.string().min(1),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),
});

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

export const redactEnvironment = (config: EnvironmentConfig): Record<string, unknown> => ({
  ...config,
  DATABASE_URL: '[REDACTED]',
  REDIS_PASSWORD: config.REDIS_PASSWORD ? '[REDACTED]' : undefined,
  JWT_SECRET: '[REDACTED]',
});
