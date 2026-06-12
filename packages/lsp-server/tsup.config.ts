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
  // Bundled CJS deps call require('util') etc.; esbuild's ESM require-shim
  // throws on Node built-ins unless a real require is in scope.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
