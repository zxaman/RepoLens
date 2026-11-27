import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'apps/cli/src/**/*.test.ts',
      'apps/desktop/electron/**/*.test.ts',
    ],
    clearMocks: true,
    restoreMocks: true,
  },
});
