import { describe, expect, it, vi } from 'vitest';
import {
  AiProviderError,
  AiProviderRegistry,
  MockAiProvider,
  PromptRegistry,
  executeAiRequest,
  parseStructuredOutput,
} from '../src';

const request = {
  model: 'mock-v1',
  messages: [{ role: 'USER' as const, content: 'probe' }],
  outputFormat: 'TEXT' as const,
};

describe('provider-neutral AI infrastructure', () => {
  it('registers and resolves provider descriptors', () => {
    const registry = new AiProviderRegistry([new MockAiProvider()]);
    expect(registry.list()).toEqual([
      { key: 'mock', displayName: 'Fournisseur déterministe (mock)', requiresCredentials: false },
    ]);
    expect(registry.get('MOCK').key).toBe('mock');
  });

  it('returns deterministic text and normalized usage', async () => {
    const provider = new MockAiProvider();
    await expect(provider.generate(request)).resolves.toEqual({
      text: 'mock:probe',
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      providerRequestId: 'mock-request-1',
    });
  });

  it('returns and validates deterministic structured output', async () => {
    const result = await new MockAiProvider({ scenario: 'STRUCTURED_SUCCESS' }).generate({
      ...request,
      outputFormat: 'JSON',
    });
    expect(
      parseStructuredOutput(result.text, {
        parse(value) {
          if (!value || typeof value !== 'object' || !('ok' in value)) throw new Error('invalid');
          return value as { ok: boolean };
        },
      }),
    ).toMatchObject({ ok: true });
  });

  it('rejects malformed structured output with a normalized error', async () => {
    const result = await new MockAiProvider({ scenario: 'MALFORMED_STRUCTURED' }).generate({
      ...request,
      outputFormat: 'JSON',
    });
    expect(() => parseStructuredOutput(result.text, { parse: (value) => value })).toThrowError(
      expect.objectContaining({ code: 'AI_MALFORMED_RESPONSE', retryable: false }),
    );
  });

  it('times out and records bounded retries', async () => {
    await expect(
      executeAiRequest(
        new MockAiProvider({ scenario: 'TIMEOUT' }),
        request,
        { timeoutMs: 10, maxRetries: 1 },
        undefined,
        { sleep: () => Promise.resolve() },
      ),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT', retryCount: 1 });
  });

  it('retries retryable failures then succeeds', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const result = await executeAiRequest(
      new MockAiProvider({ scenario: 'RETRYABLE_FAILURE', failuresBeforeSuccess: 2 }),
      request,
      { timeoutMs: 100, maxRetries: 2 },
      undefined,
      { sleep },
    );
    expect(result.retryCount).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable failures', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await expect(
      executeAiRequest(
        new MockAiProvider({ scenario: 'NON_RETRYABLE_FAILURE' }),
        request,
        { timeoutMs: 100, maxRetries: 3 },
        undefined,
        { sleep },
      ),
    ).rejects.toMatchObject({ retryable: false, retryCount: 0 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    ['RATE_LIMIT', 'AI_RATE_LIMITED', 'RATE_LIMIT', true],
    ['AUTHENTICATION_FAILURE', 'AI_AUTHENTICATION_FAILED', 'AUTHENTICATION', false],
  ] as const)('normalizes %s', async (scenario, code, category, retryable) => {
    await expect(new MockAiProvider({ scenario }).generate(request)).rejects.toMatchObject({
      code,
      category,
      retryable,
    });
  });
});

describe('versioned prompt infrastructure', () => {
  it('renders deterministically and keeps versions separate', () => {
    const prompts = new PromptRegistry();
    prompts.register({
      identifier: 'test.probe',
      version: 1,
      systemInstructions: 'Language: {{language}}',
      userTemplate: 'Value: {{value}}',
      requiredVariables: ['language', 'value'],
    });
    prompts.register({
      identifier: 'test.probe',
      version: 2,
      userTemplate: 'V2: {{value}}',
      requiredVariables: ['value'],
    });
    expect(prompts.render('test.probe', 1, { language: 'fr', value: 'safe' })).toEqual({
      identifier: 'test.probe',
      version: 1,
      systemInstructions: 'Language: fr',
      userPrompt: 'Value: safe',
    });
    expect(prompts.render('test.probe', 2, { value: 'safe' }).userPrompt).toBe('V2: safe');
  });

  it('never silently substitutes a missing variable', () => {
    const prompts = new PromptRegistry();
    prompts.register({
      identifier: 'test.missing',
      version: 1,
      userTemplate: '{{required}}',
      requiredVariables: ['required'],
    });
    expect(() => prompts.render('test.missing', 1, {})).toThrow('Missing prompt variables');
  });

  it('does not expose arbitrary provider errors', () => {
    const error = new AiProviderError(
      'AI_PROVIDER_ERROR',
      'UNKNOWN',
      'safe provider message',
      false,
    );
    expect(JSON.stringify(error)).not.toContain('credential');
  });
});
