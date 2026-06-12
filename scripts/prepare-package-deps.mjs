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
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Anchor: mcp-server workspace package root
const mcpPkgPath = require.resolve('airtable-user-mcp/package.json');
const mcpRoot = dirname(mcpPkgPath);

const extensionNodeModules = join(__dirname, '..', 'packages', 'extension', 'dist', 'node_modules');

const packagesToCopy = ['patchright', 'patchright-core', 'otpauth', '@ngrok/ngrok'];

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

// ── Symlink-escape guard ─────────────────────────────────────────────────
// `cpSync(..., { dereference: true })` follows EVERY symlink in the tree and
// copies its target into the VSIX. A trojanized npm package could ship a
// symlink pointing at ~/.ssh, CI credentials, etc., and the target file would
// silently end up inside the published artifact. Before copying, walk the
// tree (following directory symlinks, cycle-safe) and require every symlink
// to resolve inside the workspace node_modules tree — pnpm's legitimate
// nested-dependency links all resolve into <workspace>/node_modules/.pnpm.

const workspaceRoot = realpathSync(join(__dirname, '..'));

// Windows paths are case-insensitive; normalize before prefix comparison.
const normalizeForCompare = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const isWithin = (child, parent) => {
  const c = normalizeForCompare(child);
  const p = normalizeForCompare(parent);
  return c === p || c.startsWith(p + sep);
};

function assertSafeSymlinks(rootDir) {
  const allowedRoots = [realpathSync(rootDir), join(workspaceRoot, 'node_modules')];
  const visited = new Set();
  const stack = [realpathSync(rootDir)];

  while (stack.length > 0) {
    const dir = stack.pop();
    const dirKey = normalizeForCompare(dir);
    if (visited.has(dirKey)) continue;
    visited.add(dirKey);

    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      let stat;
      try { stat = lstatSync(entryPath); } catch { continue; }

      if (stat.isSymbolicLink()) {
        let resolved;
        try {
          resolved = realpathSync(entryPath);
        } catch {
          throw new Error(`Refusing to package: broken symlink ${entryPath}`);
        }
        if (!allowedRoots.some((root) => isWithin(resolved, root))) {
          throw new Error(
            `Refusing to package: symlink escapes workspace node_modules:\n  ${entryPath}\n  → ${resolved}`
          );
        }
        // dereference:true copies the target's contents too — keep walking
        // through it so a second-level symlink can't smuggle files out.
        try {
          if (lstatSync(resolved).isDirectory()) stack.push(resolved);
        } catch { /* target vanished — cpSync will surface it */ }
      } else if (stat.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }
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

  assertSafeSymlinks(realSource);

  const target = join(extensionNodeModules, packageName);
  // dereference: true — follow symlinks and copy real files, required for
  // pnpm's symlinked store to produce a self-contained VSIX.
  cpSync(realSource, target, { recursive: true, dereference: true });
  console.log(`✓ Copied ${packageName} → dist/node_modules/${packageName}  (from ${realSource})`);
}

// Copy @airtable-formula/language-services (workspace package — not on npm,
// so it cannot be resolved from the mcp-server scope like patchright/otpauth).
// The extension's bundled extension.js require()s it at runtime; without this
// copy the packaged VSIX fails to activate ("Cannot find module" error) and
// the dashboard webview is stuck in a permanent loading loop.
const lsSource = join(__dirname, '..', 'packages', 'language-services');
const lsTarget = join(extensionNodeModules, '@airtable-formula', 'language-services');
mkdirSync(dirname(lsTarget), { recursive: true });
cpSync(join(lsSource, 'package.json'), join(lsTarget, 'package.json'));
cpSync(join(lsSource, 'dist'), join(lsTarget, 'dist'), { recursive: true });
console.log('✓ Copied @airtable-formula/language-services → dist/node_modules/@airtable-formula/language-services');

console.log('✓ Package deps prepared');
