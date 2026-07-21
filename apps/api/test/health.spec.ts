import { describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/modules/health/health.controller';
import { HealthService } from '../src/modules/health/health.service';

const database = { ping: vi.fn(() => Promise.resolve()) };
const redis = { ping: vi.fn(() => Promise.resolve()) };

describe('Health endpoints', () => {
  it('reports the process as live', () => {
    const service = new HealthService(database as never, redis as never);
    expect(new HealthController(service).live().status).toBe('ok');
  });

  it('reports readiness only when PostgreSQL and Redis respond', async () => {
    const service = new HealthService(database as never, redis as never);
    const result = await service.ready();
    expect(result).toMatchObject({
      status: 'ok',
      services: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('reports unavailable when a dependency fails', async () => {
    const failingDatabase = { ping: vi.fn(() => Promise.reject(new Error('offline'))) };
    const service = new HealthService(failingDatabase as never, redis as never);
    expect((await service.ready()).status).toBe('unavailable');
  });
});
