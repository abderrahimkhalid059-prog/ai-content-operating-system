import { AiProviderError } from './ai-errors';

export interface StructuredOutputValidator<T> {
  parse(value: unknown): T;
}

export function parseStructuredOutput<T>(text: string, validator: StructuredOutputValidator<T>): T {
  try {
    return validator.parse(JSON.parse(text) as unknown);
  } catch {
    throw new AiProviderError(
      'AI_MALFORMED_RESPONSE',
      'MALFORMED_RESPONSE',
      'AI provider returned an invalid structured response.',
      false,
    );
  }
}
