# API foundations

The REST base is `/api/v1`. Health routes are public but return only abstract `up`/`down` state. Swagger is served at `/api/docs`. Errors follow the shared `ApiErrorResponse` envelope and include the request ID returned in `x-request-id`. Infrastructure test-job routes are development validation tools and are disabled when `NODE_ENV=production`.
