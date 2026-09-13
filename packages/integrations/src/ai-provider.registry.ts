import type { AiProvider, AiProviderDescriptor } from '@ai-content-os/contracts';
import { AiProviderError } from './ai-errors';

export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();

  constructor(providers: AiProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: AiProvider): void {
    const key = provider.key.trim().toLowerCase();
    if (!key || this.providers.has(key)) {
      throw new Error(`AI provider key is empty or already registered: ${key || '[empty]'}`);
    }
    this.providers.set(key, provider);
  }

  get(key: string): AiProvider {
    const provider = this.providers.get(key.trim().toLowerCase());
    if (!provider) {
      throw new AiProviderError(
        'AI_INVALID_REQUEST',
        'INVALID_REQUEST',
        'Configured AI provider is unavailable.',
        false,
      );
    }
    return provider;
  }

  has(key: string): boolean {
    return this.providers.has(key.trim().toLowerCase());
  }

  list(): AiProviderDescriptor[] {
    return [...this.providers.values()]
      .map(({ key, displayName, requiresCredentials }) => ({
        key,
        displayName,
        requiresCredentials,
      }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }
}
