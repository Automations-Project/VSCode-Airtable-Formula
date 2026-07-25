import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared/src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/test-setup.ts'],
    include: ['src/test/**/*.test.ts', 'src/test/**/*.test.tsx'],
    exclude: ['**/.ds-src/**', '**/.ds-css/**', '**/dist/**', '**/node_modules/**'],
    css: true,
    restoreMocks: true,
    clearMocks: true,
  },
});
