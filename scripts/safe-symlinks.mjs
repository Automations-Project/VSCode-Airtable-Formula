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
 * require every symlink to resolve inside an allowed root. There are two
 * legitimately different sets of allowed roots, so the caller must say which
 * one applies — there is no default, because silently picking one back into a
 * single implicit global is exactly the mistake this replaces:
 *
 *   OWN_ROOT_ONLY — for a foreign tarball/cache tree (registry tarballs
 *     unpacked by `tar`, which happily creates whatever symlinks the archive
 *     asks for) or the digest generator's own throwaway scratch extraction.
 *     Only the tree's own canonical root may be a link target; nothing
 *     legitimate ever needs to point further out.
 *
 *   ALLOW_WORKSPACE_NODE_MODULES — for a tree that IS (or is copied from) an
 *     installed pnpm package. pnpm's store layout legitimately nests real
 *     dependency links that resolve into the workspace `node_modules` root
 *     (the `.pnpm` virtual store), so that root is additionally allowed.
 *
 * Lives here rather than in `prepare-package-deps.mjs` so the foreign-package
 * path (`vendor-platform-packages.mjs`, which unpacks registry tarballs with
 * `tar`) gets the identical walking/comparison logic the installed-package
 * path already had — only the allowed-roots policy differs between them.
 */

import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const workspaceRoot = realpathSync(join(__dirname, '..'));

/** The two symlink policies a call site can choose. See file header. */
export const SYMLINK_POLICY = Object.freeze({
  OWN_ROOT_ONLY: 'own-root-only',
  ALLOW_WORKSPACE_NODE_MODULES: 'allow-workspace-node-modules',
});

// Windows paths are case-insensitive; normalize before prefix comparison.
const normalizeForCompare = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

const isWithin = (child, parent) => {
  const c = normalizeForCompare(child);
  const p = normalizeForCompare(parent);
  return c === p || c.startsWith(p + sep);
};

/**
 * Throw if any symlink under `rootDir` resolves outside the roots `policy`
 * allows, or is broken.
 *
 * `policy` is required — one of `SYMLINK_POLICY.OWN_ROOT_ONLY` or
 * `SYMLINK_POLICY.ALLOW_WORKSPACE_NODE_MODULES`; see the file header for which
 * one a given call site needs.
 *
 * `workspaceNodeModulesRoot` is a test-only override for the workspace
 * `node_modules` path `ALLOW_WORKSPACE_NODE_MODULES` consults; production call
 * sites never pass it and get the real workspace root.
 */
export function assertSafeSymlinks(
  rootDir,
  policy,
  { workspaceNodeModulesRoot = join(workspaceRoot, 'node_modules') } = {}
) {
  if (policy !== SYMLINK_POLICY.OWN_ROOT_ONLY && policy !== SYMLINK_POLICY.ALLOW_WORKSPACE_NODE_MODULES) {
    throw new Error(
      'assertSafeSymlinks: a policy is required — pass SYMLINK_POLICY.OWN_ROOT_ONLY or ' +
      `SYMLINK_POLICY.ALLOW_WORKSPACE_NODE_MODULES (got: ${JSON.stringify(policy)})`
    );
  }

  // The root must be canonicalized — symlink targets are compared after
  // realpathSync, so an un-resolved allowlist entry (e.g. the workspace
  // itself behind a symlink, as in a git worktree) would reject legitimate
  // pnpm links.
  const allowedRoots = [realpathSync(rootDir)];

  if (policy === SYMLINK_POLICY.ALLOW_WORKSPACE_NODE_MODULES) {
    // A no-install checkout (e.g. the advisory verify-pins CI job, which
    // deliberately skips `pnpm install` because it needs only Node builtins,
    // the repo's scripts, the lockfile and `tar`) has no node_modules at all.
    // Absence is not a violation — it just means this allowance does not
    // apply, and the tree is held to its own root only.
    if (existsSync(workspaceNodeModulesRoot)) {
      allowedRoots.push(realpathSync(workspaceNodeModulesRoot));
    }
  }

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
            `Refusing to package: symlink escapes its allowed root:\n  ${entryPath}\n  → ${resolved}`
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
