export type HealthState = 'ok' | 'degraded' | 'unavailable';

export interface DependencyHealth {
  status: 'up' | 'down';
}

export interface HealthResponse {
  status: HealthState;
  timestamp: string;
  services?: Record<string, DependencyHealth>;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details: ApiErrorDetail[];
    requestId: string;
  };
  timestamp: string;
  path: string;
}

export interface PaginationResponse<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';

export interface JobStatusResponse {
  id: string;
  name: string;
  state: JobState;
  correlationId: string;
  result?: unknown;
  failedReason?: string;
}
