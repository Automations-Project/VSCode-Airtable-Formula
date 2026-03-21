/**
 * Copy patchright + patchright-core from mcp-internal-airtable's node_modules
 * into dist/node_modules/ so the VSIX ships with browser automation support.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Find mcp-internal-airtable's node_modules
const mcpPkgPath = require.resolve('mcp-internal-airtable/package.json');
const mcpRoot = dirname(mcpPkgPath);
const mcpNodeModules = join(mcpRoot, 'node_modules');

const extensionNodeModules = join(__dirname, '..', 'packages', 'extension', 'dist', 'node_modules');

const packagesToCopy = ['patchright', 'patchright-core'];

rmSync(extensionNodeModules, { recursive: true, force: true });
mkdirSync(extensionNodeModules, { recursive: true });

for (const packageName of packagesToCopy) {
  const source = join(mcpNodeModules, packageName);
  const target = join(extensionNodeModules, packageName);

  if (!existsSync(source)) {
    console.warn(`⚠ Package "${packageName}" not found at ${source} — skipping`);
    continue;
  }

  cpSync(source, target, { recursive: true });
  console.log(`✓ Copied ${packageName} → dist/node_modules/${packageName}`);
}

console.log('✓ Package deps prepared');
