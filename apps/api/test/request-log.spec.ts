import { describe, expect, it } from 'vitest';
import {
  sanitizeLoggedRequest,
  sanitizeRequestTarget,
} from '../src/common/logging/request-log.serializer';

describe('Request log sanitization', () => {
  it('removes Blogger callback query parameters from logged requests and API paths', () => {
    const callback =
      '/api/v1/integrations/blogger/callback?code=secret-code&state=secret-state&scope=blogger';
    expect(sanitizeRequestTarget(callback)).toBe('/api/v1/integrations/blogger/callback');
    const sanitized = sanitizeLoggedRequest({
      method: 'GET',
      url: callback,
      query: { code: 'secret-code', state: 'secret-state', scope: 'blogger' },
    });
    expect(sanitized).toMatchObject({
      method: 'GET',
      url: '/api/v1/integrations/blogger/callback',
      query: {},
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/secret-code|secret-state/);
  });

  it('preserves non-callback request targets', () => {
    const target = '/api/v1/workspaces?page=2';
    expect(sanitizeRequestTarget(target)).toBe(target);
    const request = { url: target, query: { page: '2' } };
    expect(sanitizeLoggedRequest(request)).toBe(request);
  });
});
