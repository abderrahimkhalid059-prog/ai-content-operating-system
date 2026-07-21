import { z } from 'zod';

const webEnvironmentSchema = z.object({
  VITE_API_URL: z.string().url(),
});

const rawEnvironment = import.meta.env as Record<string, unknown>;

export const webConfig = webEnvironmentSchema.parse({
  VITE_API_URL: rawEnvironment['VITE_API_URL'] ?? 'http://localhost:3000/api/v1',
});
