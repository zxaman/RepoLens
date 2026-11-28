import eslint from '@eslint/js';
import angular from 'angular-eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out-tsc/**',
      '**/coverage/**',
      '**/.angular/**',
      'fixtures/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
  },
  {
    files: [
      'apps/desktop/electron/**/*.ts',
      'apps/cli/**/*.ts',
      'packages/**/*.ts',
      'scripts/**/*.mjs',
      'vitest.config.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/desktop/src/**/*.ts'],
    extends: [...angular.configs.tsRecommended],
    languageOptions: {
      globals: globals.browser,
    },
    processor: angular.processInlineTemplates,
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
  },
);
