import type {
  AiGenerationRequest,
  AiGenerationResult,
  AiProvider,
  AiProviderContext,
} from '@ai-content-os/contracts';
import { AiProviderError, normalizeAiProviderError } from './ai-errors';

export interface AiExecutionPolicy {
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs?: number;
}

export interface AiExecutionResult {
  result: AiGenerationResult;
  retryCount: number;
  latencyMs: number;
}

export interface AiExecutionDependencies {
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export async function executeAiRequest(
  provider: AiProvider,
  request: AiGenerationRequest,
  policy: AiExecutionPolicy,
  context?: AiProviderContext,
  dependencies: AiExecutionDependencies = {},
): Promise<AiExecutionResult> {
  const sleep =
    dependencies.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let retryCount = 0;
  for (;;) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const result = await provider.generate({ ...request, signal: controller.signal }, context);
      return { result, retryCount, latencyMs: Math.max(0, now() - startedAt) };
    } catch (error) {
      const normalized = normalizeAiProviderError(error);
      if (!normalized.retryable || retryCount >= policy.maxRetries) {
        normalized.retryCount = retryCount;
        throw normalized;
      }
      const delay =
        normalized.retryAfterMs ?? Math.min((policy.baseDelayMs ?? 100) * 2 ** retryCount, 5_000);
      retryCount += 1;
      await sleep(delay);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function requireSafeExecutionPolicy(policy: AiExecutionPolicy): void {
  if (
    !Number.isInteger(policy.timeoutMs) ||
    policy.timeoutMs < 50 ||
    policy.timeoutMs > 120_000 ||
    !Number.isInteger(policy.maxRetries) ||
    policy.maxRetries < 0 ||
    policy.maxRetries > 5
  ) {
    throw new AiProviderError(
      'AI_INVALID_REQUEST',
      'INVALID_REQUEST',
      'AI execution policy is outside safe bounds.',
      false,
    );
  }
}
