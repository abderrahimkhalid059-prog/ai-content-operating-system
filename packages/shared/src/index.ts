export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export const SERVICE_NAMES = {
  api: 'api',
  worker: 'worker',
  database: 'database',
  redis: 'redis',
  queue: 'queue',
} as const;

export const QUEUE_NAMES = { system: 'system' } as const;
export const JOB_NAMES = { healthCheck: 'system.health-check' } as const;

export const ERROR_CODES = {
  validation: 'VALIDATION_ERROR',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  internal: 'INTERNAL_ERROR',
  infrastructureUnavailable: 'INFRASTRUCTURE_UNAVAILABLE',
} as const;

export type CorrelationId = string;

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const toIsoDate = (date: Date = new Date()): string => date.toISOString();
