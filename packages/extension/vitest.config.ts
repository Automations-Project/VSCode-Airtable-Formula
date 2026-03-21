import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/*.test.ts'],
    exclude: ['src/test/suite/**', 'src/test/extension.test.ts', 'src/test/runTest.ts'],
  },
});
