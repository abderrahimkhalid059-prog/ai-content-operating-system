const BLOGGER_CALLBACK_SUFFIX = '/integrations/blogger/callback';

type LoggedRequest = {
  url?: string;
  query?: Record<string, unknown>;
  [key: string]: unknown;
};

export function sanitizeRequestTarget(target: string): string {
  const queryIndex = target.indexOf('?');
  if (queryIndex < 0) return target;
  const path = target.slice(0, queryIndex);
  return path.endsWith(BLOGGER_CALLBACK_SUFFIX) ? path : target;
}

export function sanitizeLoggedRequest(request: LoggedRequest): LoggedRequest {
  if (!request.url || sanitizeRequestTarget(request.url) === request.url) return request;
  return {
    ...request,
    url: sanitizeRequestTarget(request.url),
    query: {},
  };
}
