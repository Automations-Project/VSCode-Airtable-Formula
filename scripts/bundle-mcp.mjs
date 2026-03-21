/**
 * Bundle the MCP server from mcp-internal-airtable into a single self-contained
 * ESM file using esbuild. Browser automation (patchright) is kept external and
 * vendored separately by prepare-package-deps.mjs.
 */
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve the entry point of mcp-internal-airtable
const pkgJsonPath = require.resolve('mcp-internal-airtable/package.json');
const pkgRoot = path.dirname(pkgJsonPath);
const entryPoint = path.join(pkgRoot, 'src', 'index.js');
const outDir = path.resolve(__dirname, '../packages/extension/dist/mcp');

await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: path.join(outDir, 'index.mjs'),
  // patchright has native binaries — vendored separately
  external: ['patchright', 'patchright-core'],
  logLevel: 'info',
});

console.log('✓ MCP server bundled to', outDir);
