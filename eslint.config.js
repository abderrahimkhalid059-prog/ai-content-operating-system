const eslint = require('@eslint/js');
const prettier = require('eslint-config-prettier');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/generated/**', '.npm-cache/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['**/*.config.js', '**/*.config.ts', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['infrastructure/scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Prisma 7's generated TypeScript client is intentionally @ts-nocheck, so
    // typed ESLint cannot resolve its model return types. tsc still checks these consumers.
    files: [
      'packages/database/prisma/seed.ts',
      'packages/database/test/relationships.integration.spec.ts',
      'packages/database/test/seed.integration.spec.ts',
      'apps/api/test/phase1.integration.spec.ts',
      'apps/api/test/phase2-blogger.integration.spec.ts',
      'apps/worker/test/blogger-sync.integration.spec.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: ['packages/integrations/test/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);
