/**
 * Tests for the two symlink policies `assertSafeSymlinks` exposes.
 *
 * Run directly with `node --test scripts/safe-symlinks.test.mjs`, or via the
 * root `pnpm test`. Uses only `node:test` + `node:assert` + `node:fs` — no
 * dependency on `pnpm install` having run, matching the advisory
 * `verify-binary-pins.yml` job this guards (it deliberately skips install).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeSymlinks, SYMLINK_POLICY } from './safe-symlinks.mjs';

function makeScratch() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'safe-symlinks-test-')));
}

/**
 * Some CI runners refuse unprivileged symlink creation. Skip the individual
 * test rather than fail the whole suite when that happens — the guard itself
 * is still exercised everywhere else it can be.
 */
function trySymlink(t, target, linkPath, type) {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    t.skip(`symlink creation not permitted on this runner: ${error.message}`);
    return false;
  }
}

// ── Policy is mandatory ──────────────────────────────────────────────────

test('assertSafeSymlinks throws if no policy is given', () => {
  const root = makeScratch();
  try {
    assert.throws(() => assertSafeSymlinks(root), /policy is required/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('assertSafeSymlinks throws on an unrecognised policy value', () => {
  const root = makeScratch();
  try {
    assert.throws(() => assertSafeSymlinks(root, 'not-a-real-policy'), /policy is required/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── OWN_ROOT_ONLY (foreign tarball / cache trees, digest scratch extraction) ──

test('OWN_ROOT_ONLY allows a symlink that resolves inside the tree itself', (t) => {
  const root = makeScratch();
  try {
    const realDir = join(root, 'real');
    mkdirSync(realDir);
    writeFileSync(join(realDir, 'file.txt'), 'ok');
    if (!trySymlink(t, realDir, join(root, 'link'), 'dir')) return;

    assert.doesNotThrow(() => assertSafeSymlinks(root, SYMLINK_POLICY.OWN_ROOT_ONLY));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OWN_ROOT_ONLY refuses a symlink escaping to a marker credential file', (t) => {
  const root = makeScratch();
  const outside = makeScratch();
  try {
    const markerDir = join(outside, 'ssh');
    mkdirSync(markerDir);
    writeFileSync(join(markerDir, 'id_rsa'), 'MARKER-CREDENTIAL-DO-NOT-COPY');
    if (!trySymlink(t, markerDir, join(root, 'sneaky'), 'dir')) return;

    assert.throws(
      () => assertSafeSymlinks(root, SYMLINK_POLICY.OWN_ROOT_ONLY),
      /escapes its allowed root/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('OWN_ROOT_ONLY ignores a workspaceNodeModulesRoot override — it never widens this policy', (t) => {
  const root = makeScratch();
  const fakeNodeModules = makeScratch();
  try {
    // Symlink resolves into what WOULD be an allowed root under the other
    // policy. Under OWN_ROOT_ONLY it must still be refused.
    if (!trySymlink(t, fakeNodeModules, join(root, 'link'), 'dir')) return;

    assert.throws(
      () => assertSafeSymlinks(root, SYMLINK_POLICY.OWN_ROOT_ONLY, { workspaceNodeModulesRoot: fakeNodeModules }),
      /escapes its allowed root/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(fakeNodeModules, { recursive: true, force: true });
  }
});

test('a broken symlink is refused under OWN_ROOT_ONLY', (t) => {
  const root = makeScratch();
  try {
    const missingTarget = join(root, 'does-not-exist');
    if (!trySymlink(t, missingTarget, join(root, 'broken'), 'file')) return;

    assert.throws(() => assertSafeSymlinks(root, SYMLINK_POLICY.OWN_ROOT_ONLY), /broken symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ALLOW_WORKSPACE_NODE_MODULES (installed pnpm packages) ──────────────────

test('ALLOW_WORKSPACE_NODE_MODULES allows a symlink resolving into workspace node_modules', (t) => {
  const root = makeScratch();
  const fakeNodeModules = makeScratch();
  try {
    const pnpmStoreDir = join(fakeNodeModules, '.pnpm', 'some-pkg@1.0.0', 'node_modules', 'some-pkg');
    mkdirSync(pnpmStoreDir, { recursive: true });
    writeFileSync(join(pnpmStoreDir, 'index.js'), 'module.exports = {};');
    if (!trySymlink(t, pnpmStoreDir, join(root, 'some-pkg'), 'dir')) return;

    assert.doesNotThrow(() =>
      assertSafeSymlinks(root, SYMLINK_POLICY.ALLOW_WORKSPACE_NODE_MODULES, {
        workspaceNodeModulesRoot: fakeNodeModules,
      })
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(fakeNodeModules, { recursive: true, force: true });
  }
});

test('ALLOW_WORKSPACE_NODE_MODULES refuses an escape to a marker credential file outside both allowed roots', (t) => {
  const root = makeScratch();
  const fakeNodeModules = makeScratch();
  const outside = makeScratch();
  try {
    writeFileSync(join(outside, 'credentials.json'), '{"MARKER":"CREDENTIAL-DO-NOT-COPY"}');
    if (!trySymlink(t, outside, join(root, 'sneaky'), 'dir')) return;

    assert.throws(
      () => assertSafeSymlinks(root, SYMLINK_POLICY.ALLOW_WORKSPACE_NODE_MODULES, {
        workspaceNodeModulesRoot: fakeNodeModules,
      }),
      /escapes its allowed root/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(fakeNodeModules, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// ── The actual bug: a missing node_modules must not crash the no-install workflow ──

test('ALLOW_WORKSPACE_NODE_MODULES: a missing node_modules does not throw ENOENT — the allowance just does not apply', (t) => {
  const root = makeScratch();
  const missingNodeModules = join(root, `missing-node-modules-${process.pid}-${Date.now()}`);
  try {
    const realDir = join(root, 'real');
    mkdirSync(realDir);
    if (!trySymlink(t, realDir, join(root, 'link'), 'dir')) return;

    assert.doesNotThrow(() =>
      assertSafeSymlinks(root, SYMLINK_POLICY.ALLOW_WORKSPACE_NODE_MODULES, {
        workspaceNodeModulesRoot: missingNodeModules,
      })
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ALLOW_WORKSPACE_NODE_MODULES: with node_modules missing, an escape is still refused (no silent widen to "allow everything")', (t) => {
  const root = makeScratch();
  const outside = makeScratch();
  const missingNodeModules = join(root, `missing-node-modules-${process.pid}-${Date.now()}-2`);
  try {
    if (!trySymlink(t, outside, join(root, 'sneaky'), 'dir')) return;

    assert.throws(
      () => assertSafeSymlinks(root, SYMLINK_POLICY.ALLOW_WORKSPACE_NODE_MODULES, {
        workspaceNodeModulesRoot: missingNodeModules,
      }),
      /escapes its allowed root/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('ALLOW_WORKSPACE_NODE_MODULES: default (no override) never crashes, matching real call sites', () => {
  // This is the exact shape of the production call — no options object — run
  // against whatever this machine's real workspace node_modules state
  // happens to be (present in a normal dev checkout, absent in the advisory
  // verify-pins CI job that skips `pnpm install`). It must not throw either
  // way as long as the tree itself has no escaping symlinks.
  const root = makeScratch();
  try {
    assert.doesNotThrow(() => assertSafeSymlinks(root, SYMLINK_POLICY.ALLOW_WORKSPACE_NODE_MODULES));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OWN_ROOT_ONLY: default (no override) never touches node_modules and never crashes', () => {
  // Regression test for the actual CI failure: record-native-binary-digests.mjs
  // calls assertSafeSymlinks(unpacked, SYMLINK_POLICY.OWN_ROOT_ONLY) with no
  // options, in a workflow that never ran `pnpm install`. This must succeed
  // regardless of whether the real workspace node_modules exists, because
  // OWN_ROOT_ONLY must never consult it.
  const root = makeScratch();
  try {
    assert.doesNotThrow(() => assertSafeSymlinks(root, SYMLINK_POLICY.OWN_ROOT_ONLY));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
