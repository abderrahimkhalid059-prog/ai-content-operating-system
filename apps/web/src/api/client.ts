import type { ApiErrorResponse, LoginResponse } from '@ai-content-os/contracts';
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

let accessToken: string | undefined;
let refreshPromise: Promise<LoginResponse> | undefined;

export const setAccessToken = (token: string | undefined): void => {
  accessToken = token;
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
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

async function send<T>(
  path: string,
  init?: RequestInit,
  token: string | null | undefined = accessToken,
): Promise<T> {
  const response = await fetch(`${webConfig.VITE_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  return parseResponse<T>(response);
}

export async function refreshAccessToken(): Promise<LoginResponse> {
  refreshPromise ??= send<LoginResponse>('/auth/refresh', { method: 'POST' }, null)
    .then((result) => {
      setAccessToken(result.accessToken);
      return result;
    })
    .catch((error: unknown) => {
      setAccessToken(undefined);
      window.dispatchEvent(new Event('auth:expired'));
      throw error;
    })
    .finally(() => {
      refreshPromise = undefined;
    });
  return refreshPromise;
}

export function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return send<T>(
    path,
    init,
    path === '/auth/login' || path === '/auth/refresh' ? null : accessToken,
  );
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await send<T>(path, init);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.status !== 401 || path.startsWith('/auth/')) {
      throw error;
    }
    const refreshed = await refreshAccessToken();
    return send<T>(path, init, refreshed.accessToken);
  }
}
