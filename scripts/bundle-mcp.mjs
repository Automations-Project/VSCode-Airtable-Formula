/**
 * Bundle the MCP server from airtable-user-mcp into self-contained ESM
 * files using esbuild. Browser automation (patchright) is kept external and
 * vendored separately by prepare-package-deps.mjs.
 *
 * Bundles:
 *   - index.mjs        — main MCP server
 *   - login-runner.mjs  — programmatic login (spawned by extension)
 *   - health-check.mjs  — session health check (spawned by extension)
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve airtable-user-mcp source root
const pkgJsonPath = require.resolve('airtable-user-mcp/package.json');
const pkgRoot = path.dirname(pkgJsonPath);
const outDir = path.resolve(__dirname, '../packages/extension/dist/mcp');

const sharedOptions = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // patchright has native binaries — vendored separately
  external: ['patchright', 'patchright-core', 'otpauth'],
  logLevel: 'info',
};

// 1. Main MCP server
await build({
  ...sharedOptions,
  entryPoints: [path.join(pkgRoot, 'src', 'index.js')],
  outfile: path.join(outDir, 'index.mjs'),
});
console.log('✓ MCP server bundled');

// 2. Login runner (programmatic login for extension)
await build({
  ...sharedOptions,
  entryPoints: [path.join(pkgRoot, 'src', 'login-runner.js')],
  outfile: path.join(outDir, 'login-runner.mjs'),
});
console.log('✓ Login runner bundled');

// 3. Health check (session validation for extension)
await build({
  ...sharedOptions,
  entryPoints: [path.join(pkgRoot, 'src', 'health-check.js')],
  outfile: path.join(outDir, 'health-check.mjs'),
});
console.log('✓ Health check bundled');

// 4. Manual login runner (visible browser, no credentials)
await build({
  ...sharedOptions,
  entryPoints: [path.join(pkgRoot, 'src', 'manual-login-runner.js')],
  outfile: path.join(outDir, 'manual-login-runner.mjs'),
});
console.log('✓ Manual login runner bundled');

console.log('✓ All MCP bundles written to', outDir);

// 4. Write version manifest for the extension dashboard
const mcpPkgRaw = readFileSync(path.join(pkgRoot, 'package.json'), 'utf8');
const mcpPkg = JSON.parse(mcpPkgRaw);
const versionManifest = {
  mcpServer: mcpPkg.version,
  mcpServerName: mcpPkg.name,
  bundledAt: new Date().toISOString(),
  bundledFromGitSha: process.env.GITHUB_SHA || 'local-dev',
};
writeFileSync(
  path.join(outDir, 'version.json'),
  JSON.stringify(versionManifest, null, 2)
);
console.log(`✓ Version manifest: ${mcpPkg.name}@${mcpPkg.version}`);
