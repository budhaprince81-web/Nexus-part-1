import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Separate from `vite.config.ts`, which requires PORT and loads Replit-only
 * dev plugins. Tests must run in CI without either.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
  },
});
