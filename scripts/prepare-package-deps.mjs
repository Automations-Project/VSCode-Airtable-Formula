/**
 * Copy patchright + patchright-core + otpauth from the mcp-server workspace
 * package's node_modules into dist/node_modules/ so the VSIX ships with
 * browser automation support.
 *
 * In the pnpm workspace layout, patchright is installed as a symlink under
 * `packages/mcp-server/node_modules/patchright` pointing into the .pnpm
 * virtual store. We must `dereference: true` when copying so the VSIX
 * receives real files, not broken symlinks.
 *
 * We resolve each package directly via `require.resolve(<pkg>/package.json)`
 * using the mcp-server root as a paths hint, which transparently walks the
 * symlinked store and returns the real on-disk path.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Anchor: mcp-server workspace package root
const mcpPkgPath = require.resolve('airtable-user-mcp/package.json');
const mcpRoot = dirname(mcpPkgPath);

const extensionNodeModules = join(__dirname, '..', 'packages', 'extension', 'dist', 'node_modules');

const packagesToCopy = ['patchright', 'patchright-core', 'otpauth'];

rmSync(extensionNodeModules, { recursive: true, force: true });
mkdirSync(extensionNodeModules, { recursive: true });

/**
 * Find a package's root directory by resolving it from mcp-server's scope.
 * Handles two cases:
 *   1. Package exposes `./package.json` in its exports map → direct resolution.
 *   2. Package has strict exports (e.g. otpauth) → resolve main entry, then
 *      walk up until we find the package.json whose "name" matches.
 */
function resolvePackageRoot(packageName) {
  // Case 1
  try {
    const resolved = require.resolve(`${packageName}/package.json`, { paths: [mcpRoot] });
    return dirname(resolved);
  } catch { /* fall through */ }

  // Case 2 — resolve main entry, walk up
  try {
    const entry = require.resolve(packageName, { paths: [mcpRoot] });
    let dir = dirname(entry);
    // Walk up at most 6 levels looking for a package.json whose name matches
    for (let i = 0; i < 6; i++) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
          if (pkg.name === packageName) return dir;
        } catch { /* malformed package.json, keep walking */ }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* ignore */ }

  return undefined;
}

for (const packageName of packagesToCopy) {
  const realSource = resolvePackageRoot(packageName);
  if (!realSource) {
    console.warn(`⚠ Could not resolve "${packageName}" from ${mcpRoot} — skipping`);
    continue;
  }
  if (!existsSync(realSource)) {
    console.warn(`⚠ Resolved path for "${packageName}" does not exist: ${realSource} — skipping`);
    continue;
  }

  const target = join(extensionNodeModules, packageName);
  // dereference: true — follow symlinks and copy real files, required for
  // pnpm's symlinked store to produce a self-contained VSIX.
  cpSync(realSource, target, { recursive: true, dereference: true });
  console.log(`✓ Copied ${packageName} → dist/node_modules/${packageName}  (from ${realSource})`);
}

console.log('✓ Package deps prepared');
