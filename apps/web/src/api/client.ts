import type { ApiErrorResponse } from '@ai-content-os/contracts';
import { webConfig } from '../config';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiErrorResponse,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${webConfig.VITE_API_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
    throw new ApiClientError(
      body?.error.message ?? 'La requête API a échoué.',
      response.status,
      body,
    );
  }
  return response.json() as Promise<T>;
}
