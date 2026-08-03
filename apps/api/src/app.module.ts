import { randomUUID } from 'node:crypto';
import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { validateEnvironment } from '@ai-content-os/config';
import { AccessTokenGuard } from './common/auth/access-token.guard';
import { AuditModule } from './common/audit/audit.module';
import { sanitizeLoggedRequest } from './common/logging/request-log.serializer';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { DatabaseModule } from './infrastructure/database/database.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditApiModule } from './modules/audit/audit-api.module';
import { ContentProfilesModule } from './modules/content-profiles/content-profiles.module';
import { HealthModule } from './modules/health/health.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { SystemModule } from './modules/system/system.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { WebsitesModule } from './modules/websites/websites.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    LoggerModule.forRoot({
      forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.token',
            '*.secret',
            '*.apiKey',
            '*.DATABASE_URL',
            '*.JWT_ACCESS_SECRET',
            '*.REFRESH_TOKEN_SECRET',
            '*.SEED_OWNER_PASSWORD',
            '*.GOOGLE_BLOGGER_CLIENT_SECRET',
            '*.INTEGRATION_ENCRYPTION_KEY',
            '*.encryptedCredentials',
          ],
          censor: '[REDACTED]',
        },
        base: { service: 'api', environment: process.env.NODE_ENV ?? 'development' },
        timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
        genReqId: (request, response) => {
          const incoming = request.headers['x-request-id'];
          const requestId =
            typeof incoming === 'string' && incoming.length <= 128 ? incoming : undefined;
          const id = requestId ?? randomUUID();
          response.setHeader('x-request-id', id);
          return id;
        },
        customProps: (request) => ({ requestId: request.id }),
        serializers: { req: sanitizeLoggedRequest },
      },
    }),
    DatabaseModule,
    RedisModule,
    QueueModule,
    AuditModule,
    AuthModule,
    AuditApiModule,
    UsersModule,
    WorkspacesModule,
    WebsitesModule,
    ContentProfilesModule,
    IntegrationsModule,
    HealthModule,
    SystemModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AccessTokenGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
