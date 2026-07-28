import { randomUUID } from 'node:crypto';
import { JOB_NAMES, QUEUE_NAMES } from '@ai-content-os/shared';
import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { processSystemHealthJob, type SystemHealthJobData } from '../src/worker';

const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl) throw new Error('TEST_REDIS_URL is required for BullMQ integration tests.');
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue<SystemHealthJobData>(QUEUE_NAMES.system, { connection });
const queueEvents = new QueueEvents(QUEUE_NAMES.system, { connection: connection.duplicate() });
const worker = new Worker<SystemHealthJobData>(QUEUE_NAMES.system, processSystemHealthJob, {
  connection: connection.duplicate(),
});

describe('BullMQ integration', () => {
  afterAll(async () => {
    await worker.close();
    await queue.obliterate({ force: true });
    await queueEvents.close();
    await queue.close();
    await connection.quit();
  });

  it('enqueues, retries, and completes the infrastructure job', async () => {
    const correlationId = randomUUID();
    const job = await queue.add(
      JOB_NAMES.healthCheck,
      {
        correlationId,
        requestedAt: new Date().toISOString(),
        failUntilAttempt: 1,
      },
      { attempts: 2, backoff: { type: 'exponential', delay: 10 } },
    );
    const result: unknown = await job.waitUntilFinished(queueEvents, 10_000);
    expect(result).toMatchObject({ healthy: true, correlationId });
    expect((await queue.getJob(job.id!))?.attemptsMade).toBe(2);
  }, 15_000);
});
