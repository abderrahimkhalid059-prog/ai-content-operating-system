import type { Job } from 'bullmq';

export interface SystemHealthJobData {
  correlationId: string;
  requestedAt: string;
  failUntilAttempt?: number;
}

export interface SystemHealthJobResult {
  healthy: true;
  correlationId: string;
  processedAt: string;
}

export function processSystemHealthJob(
  job: Pick<Job<SystemHealthJobData>, 'data' | 'attemptsMade' | 'id'>,
): Promise<SystemHealthJobResult> {
  if (job.data.failUntilAttempt && job.attemptsMade < job.data.failUntilAttempt) {
    return Promise.reject(new Error(`Intentional infrastructure retry for job ${String(job.id)}`));
  }
  return Promise.resolve({
    healthy: true,
    correlationId: job.data.correlationId,
    processedAt: new Date().toISOString(),
  });
}
