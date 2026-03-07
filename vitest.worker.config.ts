import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['worker/__tests__/**/*.test.ts'],
    globals: true,
  },
});
