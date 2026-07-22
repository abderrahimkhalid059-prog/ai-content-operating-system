import { validateEnvironment } from '@ai-content-os/config';
import { JOB_NAMES, QUEUE_NAMES } from '@ai-content-os/shared';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { processSystemHealthJob, type SystemHealthJobData } from './worker';

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

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ context: signal }, 'Worker shutting down');
  await worker.close();
  await connection.quit();
  logger.info('Worker stopped');
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: QUEUE_NAMES.system }, 'Worker started');
