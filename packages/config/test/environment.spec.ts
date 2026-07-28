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
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
  JWT_ACCESS_TTL: '15m',
  REFRESH_TOKEN_SECRET: 'test-refresh-secret-different-thirty-two-characters',
  REFRESH_TOKEN_TTL: '7d',
  AUTH_COOKIE_NAME: 'test_refresh',
  AUTH_COOKIE_SECURE: 'false',
  PASSWORD_MIN_LENGTH: '12',
  LOGIN_RATE_LIMIT_WINDOW: '60s',
  LOGIN_RATE_LIMIT_MAX: '10',
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

  it('requires secure cookies and separate secrets in production', () => {
    expect(() => validateEnvironment({ ...valid, NODE_ENV: 'production' })).toThrow(
      /AUTH_COOKIE_SECURE/,
    );
    expect(() =>
      validateEnvironment({ ...valid, REFRESH_TOKEN_SECRET: valid.JWT_ACCESS_SECRET }),
    ).toThrow(/different/);
  });

  it('defaults development and test Blogger mode to mock with safe mutation ceilings', () => {
    const parsed = validateEnvironment(valid);
    expect(parsed.BLOGGER_MODE).toBe('mock');
    expect(parsed.BLOGGER_ALLOW_PUBLIC_PUBLISH).toBe(false);
    expect(parsed.BLOGGER_ALLOW_DELETE).toBe(false);
  });

  it('rejects invalid Blogger modes and incomplete live configuration', () => {
    expect(() => validateEnvironment({ ...valid, BLOGGER_MODE: 'unsafe' })).toThrow(/BLOGGER_MODE/);
    expect(() => validateEnvironment({ ...valid, BLOGGER_MODE: 'live' })).toThrow(
      /GOOGLE_BLOGGER_CLIENT_ID/,
    );
  });

  it('requires an explicit Blogger mode and encryption key in production', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      AUTH_COOKIE_SECURE: 'true',
      BLOGGER_MODE: undefined,
    };
    expect(() => validateEnvironment(production)).toThrow(/BLOGGER_MODE/);
  });
});
