const redisUrl = new URL(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379');

Object.assign(process.env, {
  NODE_ENV: 'test',
  API_PORT: '3001',
  WEB_PORT: '5174',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgresql://ai_content_os:development_only@localhost:5432/ai_content_os?schema=public',
  REDIS_HOST: redisUrl.hostname,
  REDIS_PORT: redisUrl.port || '6379',
  REDIS_PASSWORD: '',
  JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-thirty-two-characters',
  JWT_ACCESS_TTL: '15m',
  REFRESH_TOKEN_SECRET: 'test-refresh-secret-different-and-at-least-thirty-two',
  REFRESH_TOKEN_TTL: '7d',
  AUTH_COOKIE_NAME: 'phase1_refresh',
  AUTH_COOKIE_SECURE: 'false',
  PASSWORD_MIN_LENGTH: '12',
  LOGIN_RATE_LIMIT_WINDOW: '60s',
  LOGIN_RATE_LIMIT_MAX: '2',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'http://localhost:5174',
  APP_URL: 'http://localhost:5174',
  API_URL: 'http://localhost:3001/api/v1',
  BLOGGER_MODE: 'mock',
  GOOGLE_BLOGGER_REDIRECT_URI: 'http://localhost:3001/api/v1/integrations/blogger/callback',
  BLOGGER_ALLOW_PUBLIC_PUBLISH: 'true',
  BLOGGER_ALLOW_DELETE: 'true',
  BLOGGER_MAX_RETRIES: '2',
  BLOGGER_SYNC_PAGE_SIZE: '2',
});
