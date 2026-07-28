import { validateEnvironment } from '@ai-content-os/config';
import type { BloggerSyncJobData } from '@ai-content-os/contracts';
import { DatabaseService } from '@ai-content-os/database';
import { JOB_NAMES, QUEUE_NAMES } from '@ai-content-os/shared';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { processSystemHealthJob, type SystemHealthJobData } from './worker';
import { BloggerSyncProcessor } from './blogger-sync';

const config = validateEnvironment(process.env);
const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'worker', environment: config.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password',
      'token',
      'secret',
      'apiKey',
      'authorization',
      'cookie',
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'REFRESH_TOKEN_SECRET',
      'SEED_OWNER_PASSWORD',
      'GOOGLE_BLOGGER_CLIENT_SECRET',
      'INTEGRATION_ENCRYPTION_KEY',
      'encryptedCredentials',
    ],
    censor: '[REDACTED]',
  },
});

const connection = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});
const database = new DatabaseService(config.DATABASE_URL);
const bloggerSync = new BloggerSyncProcessor(database, config);

const worker = new Worker<SystemHealthJobData>(
  QUEUE_NAMES.system,
  async (job) => {
    logger.info(
      { jobId: job.id, correlationId: job.data.correlationId, context: JOB_NAMES.healthCheck },
      'Processing job',
    );
    return processSystemHealthJob(job);
  },
  { connection, concurrency: 5 },
);

const integrationWorker = new Worker<BloggerSyncJobData>(
  QUEUE_NAMES.integrations,
  async (job) => {
    logger.info(
      { jobId: job.id, correlationId: job.data.correlationId, context: JOB_NAMES.bloggerSyncSite },
      'Processing Blogger sync',
    );
    return bloggerSync.process(job);
  },
  { connection, concurrency: 2 },
);

worker.on('completed', (job) =>
  logger.info({ jobId: job.id, correlationId: job.data.correlationId }, 'Job completed'),
);
worker.on('failed', (job, error) =>
  logger.error(
    {
      jobId: job?.id,
      correlationId: job?.data.correlationId,
      errorCode: 'JOB_FAILED',
      stack: error.stack,
    },
    'Job failed',
  ),
);
worker.on('error', (error) =>
  logger.error({ errorCode: 'WORKER_ERROR', stack: error.stack }, 'Worker error'),
);
integrationWorker.on('completed', (job) =>
  logger.info({ jobId: job.id, correlationId: job.data.correlationId }, 'Blogger sync completed'),
);
integrationWorker.on('failed', (job, error) =>
  logger.error(
    {
      jobId: job?.id,
      correlationId: job?.data.correlationId,
      errorCode: 'BLOGGER_SYNC_JOB_FAILED',
      stack: error.stack,
    },
    'Blogger sync job failed',
  ),
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ context: signal }, 'Worker shutting down');
  await worker.close();
  await integrationWorker.close();
  await database.disconnect();
  await connection.quit();
  logger.info('Worker stopped');
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queues: [QUEUE_NAMES.system, QUEUE_NAMES.integrations] }, 'Worker started');
