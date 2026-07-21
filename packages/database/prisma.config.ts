import { defineConfig } from 'prisma/config';

const developmentUrl =
  'postgresql://ai_content_os:development_only@localhost:5432/ai_content_os?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? developmentUrl,
  },
});
