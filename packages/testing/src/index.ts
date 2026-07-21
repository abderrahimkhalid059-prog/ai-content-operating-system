import type { Server } from 'node:http';
import Redis from 'ioredis';
import request from 'supertest';

export const TEST_ENVIRONMENT = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  WEB_PORT: '5174',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/ai_content_os_test',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: '',
  JWT_SECRET: 'test-only-secret-at-least-thirty-two-characters',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'http://localhost:5174',
  APP_URL: 'http://localhost:5174',
  API_URL: 'http://localhost:3001/api/v1',
} as const;

export const httpTestClient = (server: Server) => request(server);

export const createTestRedis = (): Redis =>
  new Redis({
    host: TEST_ENVIRONMENT.REDIS_HOST,
    port: Number(TEST_ENVIRONMENT.REDIS_PORT),
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });

export async function cleanDatabase(execute: (sql: string) => Promise<unknown>): Promise<void> {
  await execute(
    'TRUNCATE TABLE job_records, audit_logs, system_settings, websites, workspace_members, workspaces, users RESTART IDENTITY CASCADE',
  );
}
