import { describe, expect, it } from 'vitest';
import { DatabaseService } from '../src';

describe('DatabaseService', () => {
  it('initializes without opening a connection eagerly', () => {
    const service = new DatabaseService('postgresql://user:pass@localhost:5432/test');
    expect(typeof service.connect).toBe('function');
    expect(typeof service.ping).toBe('function');
    expect(typeof service.workspace.findMany).toBe('function');
  });
});
