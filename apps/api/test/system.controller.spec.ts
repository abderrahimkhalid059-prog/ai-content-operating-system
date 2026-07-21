import { describe, expect, it, vi } from 'vitest';
import { SystemController } from '../src/modules/system/system.controller';

describe('SystemController', () => {
  it('enqueues a correlated infrastructure job outside production', async () => {
    const queue = {
      enqueue: vi.fn((correlationId: string) =>
        Promise.resolve({
          id: '42',
          name: 'system.health-check',
          state: 'waiting',
          correlationId,
        }),
      ),
      status: vi.fn(),
    };
    const config = { get: vi.fn(() => 'development') };
    const controller = new SystemController(queue as never, config as never);
    const result = await controller.enqueue({ requestId: 'request-1' } as never);
    expect(result.correlationId).toBe('request-1');
    expect(queue.enqueue).toHaveBeenCalledWith('request-1');
  });
});
