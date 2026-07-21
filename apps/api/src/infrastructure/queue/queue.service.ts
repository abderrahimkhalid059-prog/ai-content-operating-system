import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { JobStatusResponse, JobState } from '@ai-content-os/contracts';
import { JOB_NAMES, QUEUE_NAMES } from '@ai-content-os/shared';
import { Queue, QueueEvents } from 'bullmq';
import { RedisService } from '../redis/redis.service';

export interface SystemHealthJobData {
  correlationId: string;
  requestedAt: string;
  failUntilAttempt?: number;
}

@Injectable()
export class QueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Queue');
  readonly queue: Queue<SystemHealthJobData>;
  private readonly events: QueueEvents;

  constructor(redis: RedisService) {
    this.queue = new Queue(QUEUE_NAMES.system, { connection: redis.client });
    this.events = new QueueEvents(QUEUE_NAMES.system, { connection: redis.client.duplicate() });
  }

  async onModuleInit(): Promise<void> {
    await this.events.waitUntilReady();
    this.events.on('completed', ({ jobId }) => this.logger.log({ jobId }, 'Job completed'));
    this.events.on('failed', ({ jobId, failedReason }) =>
      this.logger.error({ jobId, failedReason }, 'Job failed'),
    );
  }

  async enqueue(correlationId: string = randomUUID()): Promise<JobStatusResponse> {
    const job = await this.queue.add(
      JOB_NAMES.healthCheck,
      { correlationId, requestedAt: new Date().toISOString() },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400, count: 1_000 },
      },
    );
    this.logger.log({ jobId: job.id, correlationId }, 'Job enqueued');
    return { id: String(job.id), name: job.name, state: 'waiting', correlationId };
  }

  async status(jobId: string): Promise<JobStatusResponse | undefined> {
    const job = await this.queue.getJob(jobId);
    if (!job) return undefined;
    const state = (await job.getState()) as JobState;
    return {
      id: String(job.id),
      name: job.name,
      state,
      correlationId: job.data.correlationId,
      ...(job.returnvalue === undefined ? {} : { result: job.returnvalue }),
      ...(job.failedReason ? { failedReason: job.failedReason } : {}),
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.events.close(), this.queue.close()]);
  }
}
