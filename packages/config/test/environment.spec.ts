import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src';

const valid = {
  NODE_ENV: 'test',
  API_PORT: '3000',
  WEB_PORT: '5173',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: '',
  JWT_SECRET: 'test-secret-at-least-thirty-two-characters',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'http://localhost:5173',
  APP_URL: 'http://localhost:5173',
  API_URL: 'http://localhost:3000/api/v1',
};

describe('validateEnvironment', () => {
  it('coerces ports and accepts a complete environment', () => {
    expect(validateEnvironment(valid).API_PORT).toBe(3000);
  });

  it('fails fast and identifies missing variables', () => {
    expect(() => validateEnvironment({ ...valid, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL/,
    );
  });
});
