import { describe, expect, it } from 'vitest';
import { processSystemHealthJob } from '../src/worker';

describe('system.health-check processor', () => {
  it('returns a correlated completion result', async () => {
    const result = await processSystemHealthJob({
      id: 'job-1',
      attemptsMade: 0,
      data: { correlationId: 'correlation-1', requestedAt: new Date().toISOString() },
    });
    expect(result).toMatchObject({ healthy: true, correlationId: 'correlation-1' });
  });

  it('fails intentionally until the configured retry attempt', async () => {
    const data = {
      correlationId: 'correlation-2',
      requestedAt: new Date().toISOString(),
      failUntilAttempt: 1,
    };
    await expect(processSystemHealthJob({ id: 'job-2', attemptsMade: 0, data })).rejects.toThrow(
      /retry/,
    );
    await expect(
      processSystemHealthJob({ id: 'job-2', attemptsMade: 1, data }),
    ).resolves.toMatchObject({ healthy: true });
  });
});
