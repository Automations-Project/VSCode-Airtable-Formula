/**
 * Symlink-escape guard for every tree we copy with `dereference: true`.
 *
 * `cpSync(..., { dereference: true })` follows EVERY symlink in the tree and
 * copies its target into the output. A trojanized npm package — installed OR
 * fetched as a foreign platform tarball — could ship a symlink pointing at
 * ~/.ssh, CI credentials, etc., and the target file would silently end up
 * inside the published artifact.
 *
 * Before copying, walk the tree (following directory symlinks, cycle-safe) and
 * require every symlink to resolve inside an allowed root. pnpm's legitimate
 * nested-dependency links all resolve into <workspace>/node_modules/.pnpm, so
 * that path plus the tree's own root is the default allowlist.
 *
 * Lives here rather than in `prepare-package-deps.mjs` so the foreign-package
 * path (`vendor-platform-packages.mjs`, which unpacks registry tarballs with
 * `tar` — and `tar` happily creates symlinks) gets the identical guard the
 * non-foreign path already had.
 */

import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const workspaceRoot = realpathSync(join(__dirname, '..'));

// Windows paths are case-insensitive; normalize before prefix comparison.
const normalizeForCompare = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

const isWithin = (child, parent) => {
  const c = normalizeForCompare(child);
  const p = normalizeForCompare(parent);
  return c === p || c.startsWith(p + sep);
};

/**
 * Throw if any symlink under `rootDir` resolves outside `rootDir` or the
 * workspace `node_modules` tree, or is broken.
 */
export function assertSafeSymlinks(rootDir) {
  // Both roots must be canonicalized — symlink targets are compared after
  // realpathSync, so an un-resolved allowlist entry (workspace itself behind
  // a symlink, e.g. a git worktree) would reject legitimate pnpm links.
  const allowedRoots = [realpathSync(rootDir), realpathSync(join(workspaceRoot, 'node_modules'))];
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
