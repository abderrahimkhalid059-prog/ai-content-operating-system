import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: './test/environment.ts',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
  resolve: {
    alias: {
      '@ai-content-os/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
      '@ai-content-os/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@ai-content-os/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@ai-content-os/integrations': path.resolve(
        __dirname,
        '../../packages/integrations/src/index.ts',
      ),
      '@ai-content-os/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
