import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@ai-content-os/contracts';
import { DatabaseService } from '@ai-content-os/database';
import { RedisService } from '../../infrastructure/redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  live(): HealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async ready(): Promise<HealthResponse> {
    const [database, redis] = await Promise.allSettled([this.database.ping(), this.redis.ping()]);
    const services = {
      database: { status: database.status === 'fulfilled' ? 'up' : 'down' } as const,
      redis: { status: redis.status === 'fulfilled' ? 'up' : 'down' } as const,
    };
    return {
      status:
        services.database.status === 'up' && services.redis.status === 'up' ? 'ok' : 'unavailable',
      timestamp: new Date().toISOString(),
      services,
    };
  }
}
