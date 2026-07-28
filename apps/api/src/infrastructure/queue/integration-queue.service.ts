import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '@ai-content-os/config';
import type { BloggerSyncJobData } from '@ai-content-os/contracts';
import { JOB_NAMES, QUEUE_NAMES } from '@ai-content-os/shared';
import { Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class IntegrationQueueService implements OnApplicationShutdown {
  private readonly queue: Queue<BloggerSyncJobData>;

  constructor(
    redis: RedisService,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {
    this.queue = new Queue(QUEUE_NAMES.integrations, { connection: redis.client });
  }

  async enqueueBloggerSync(data: BloggerSyncJobData): Promise<string> {
    const job = await this.queue.add(JOB_NAMES.bloggerSyncSite, data, {
      jobId: data.syncRunId,
      attempts: this.config.get('BLOGGER_MAX_RETRIES', { infer: true }) + 1,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 1_000 },
    });
    return String(job.id);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
