import { randomUUID } from 'node:crypto';
import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnvironment } from '@ai-content-os/config';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { DatabaseModule } from './infrastructure/database/database.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { SystemModule } from './modules/system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    LoggerModule.forRoot({
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
            '*.JWT_SECRET',
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
      },
    }),
    DatabaseModule,
    RedisModule,
    QueueModule,
    HealthModule,
    SystemModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
