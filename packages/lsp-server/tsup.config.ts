import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: ['@airtable-formula/language-services'],
  dts: false,
  clean: true,
  outDir: 'dist',
});
