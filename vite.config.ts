import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/features/isohome/**'],
      exclude: ['src/features/isohome/__tests__/**'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
      reporter: ['text', 'html'],
    },
  },
});
