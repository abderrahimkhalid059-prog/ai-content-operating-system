import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '@ai-content-os/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Redis');
  readonly client: Redis;

  constructor(config: ConfigService<EnvironmentConfig, true>) {
    this.client = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      password: config.get('REDIS_PASSWORD', { infer: true }),
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.client.on('error', (error) =>
      this.logger.error({ message: error.message }, 'Redis error'),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.client.ping();
  }
  async ping(): Promise<void> {
    await this.client.ping();
  }
  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
