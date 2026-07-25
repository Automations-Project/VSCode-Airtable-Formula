import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isProfileLockError, killProfileHolders } from '../src/profile-lock.js';

/**
 * Chrome persistent-profile lock recovery — pure unit tests.
 * No real processes are killed; killProfileHolders is driven over an injected
 * `exec` spy, and `platform` is injected so both branches run on any OS.
 */

describe('isProfileLockError', () => {
  it('is true for the Chrome exit-code-21 launch failure', () => {
    const err = new Error(
      'browserType.launchPersistentContext: Target page, context or browser has been closed',
    );
    err.exitCode = 21;
    assert.equal(isProfileLockError(err), true);
  });

  it('is true for an explicit "exitCode=21" message', () => {
    assert.equal(isProfileLockError(new Error('Chrome crashed, exitCode=21')), true);
  });

  it('is true for an "exit code 21" message', () => {
    assert.equal(isProfileLockError(new Error('process exited with exit code 21')), true);
  });

  it('is true for the standalone "has been closed" message', () => {
    assert.equal(isProfileLockError(new Error('Target page, context or browser has been closed')), true);
  });

  it('is true for a SingletonLock message (case-insensitive)', () => {
    assert.equal(isProfileLockError(new Error('failed to create /path/singletonlock')), true);
  });

  it('is true for a ProcessSingleton message', () => {
    assert.equal(isProfileLockError(new Error('Failed to create a ProcessSingleton for your profile directory')), true);
  });

  it('is true for "user data directory is already in use"', () => {
    assert.equal(isProfileLockError(new Error('The user data directory is already in use, please specify a unique value')), true);
  });

  it('accepts a bare string (not just an Error)', () => {
    assert.equal(isProfileLockError('SingletonLock present'), true);
  });

  it('is false for a normal, unrelated error', () => {
    assert.equal(isProfileLockError(new Error('Navigation timeout of 30000 ms exceeded')), false);
  });

  it('is false for null / undefined', () => {
    assert.equal(isProfileLockError(null), false);
    assert.equal(isProfileLockError(undefined), false);
  });

  it('does not match an unrelated "exit code 1"', () => {
    assert.equal(isProfileLockError(new Error('command failed with exit code 1')), false);
  });
});

/**
 * `killProfileHolders` now has exactly ONE path: ownership-guarded eviction through
 * `process-tree.evictProfileSquatters`.
 *
 * The `legacy: true` escape hatch is DELETED, along with the tests that pinned it. It was
 * test-only (production `auth.js` passes `{ configDir }` and never `legacy`), but it shipped in
 * the published `airtable-user-mcp` npm package carrying a second, independent copy of the
 * defect this module has now been hardened against three times:
 *   POSIX  `pkill -f <profileDir>` — kills EVERY process whose command line matches the profile
 *          path as a REGEX. The user's `vim …/.chrome-profile/Default/Preferences`, a `grep -r`,
 *          an `rsync` backup, a file manager. No image filter, no argv-token matching, no
 *          ownership guard, no `--type=` exclusion. One boolean away from any future caller.
 *   win32  `… -like '*<dir>*' … taskkill /T /F` — the same bare-mention widening that was just
 *          removed from `process-tree.js`'s win32 query.
 * The tests below assert its ABSENCE and pin the guarded behaviour that replaced it.
 */
describe('killProfileHolders', () => {
  function spy() {
    return {
      calls: [],
      impl: null, // optional (file, args) => any | throws
      async exec(file, args) {
        this.calls.push({ file, args });
        if (this.impl) return this.impl(file, args);
        return { stdout: '', stderr: '' };
      },
    };
  }

  it('NEVER issues `pkill -f <profileDir>` — not on any platform, not with any option', async () => {
    for (const platform of ['linux', 'darwin', 'win32']) {
      for (const opts of [{}, { legacy: true }]) {
        const s = spy();
        await killProfileHolders('/home/user/.airtable-user-mcp/.chrome-profile', {
          platform,
          configDir: '/home/user/.airtable-user-mcp',
          exec: (f, a) => s.exec(f, a),
          ...opts,
        });
        const files = s.calls.map((c) => c.file);
        assert.ok(!files.includes('pkill'), `pkill reached on ${platform} with ${JSON.stringify(opts)}`);
        assert.ok(
          !files.includes('powershell'),
          `the legacy taskkill-in-PowerShell script reached on ${platform}`,
        );
      }
    }
  });

  it('a stray `legacy: true` is inert — the guarded path runs regardless', async () => {
    // If the option were ever re-introduced by a merge, this fails rather than silently
    // re-enabling a `pkill -f`.
    const profileDir = '/home/user/.airtable-user-mcp/.chrome-profile';
    const s = spy();
    const out = await killProfileHolders(profileDir, {
      platform: 'linux',
      legacy: true,
      configDir: '/home/user/.airtable-user-mcp',
      exec: (f, a) => s.exec(f, a),
    });
    // `pgrep` (candidate generation) is the only thing the guarded POSIX path may reach for.
    assert.deepEqual(s.calls.map((c) => c.file), ['pgrep']);
    assert.deepEqual(s.calls[0].args, ['-f', '--', `--user-data-dir=${profileDir}`]);
    assert.equal(out.killed, false);
    assert.equal(out.refusedReason, null);
  });

  it('reports the pids the guarded eviction actually killed', async () => {
    const profileDir = '/home/user/.airtable-user-mcp/.chrome-profile';
    const s = spy();
    s.impl = async (file, args) => {
      if (file === 'pgrep' && args.includes('-f')) return { stdout: '4242\n' };
      if (file === 'ps') return { stdout: `/opt/google/chrome/chrome --user-data-dir=${profileDir}` };
      return { stdout: '' };
    };
    const out = await killProfileHolders(profileDir, {
      platform: 'linux',
      configDir: '/home/user/.airtable-user-mcp',
      exec: (f, a) => s.exec(f, a),
    });
    assert.equal(out.platform, 'linux');
    assert.deepEqual(out.pids, [4242]);
    assert.equal(out.killed, true);
  });

  it('NEVER throws when the injected exec rejects — returns { killed: false }', async () => {
    const s = spy();
    s.impl = () => { throw new Error('access denied'); };
    const out = await killProfileHolders('C:\\p', {
      platform: 'win32',
      configDir: 'C:\\cfg',
      exec: (f, a) => s.exec(f, a),
    });
    assert.equal(out.killed, false);
  });

  it('NEVER throws when exec rejects with a non-Error value', async () => {
    const s = spy();
    s.impl = () => Promise.reject('nope-string');
    const out = await killProfileHolders('/p', {
      platform: 'linux',
      configDir: '/cfg',
      exec: (f, a) => s.exec(f, a),
    });
    assert.equal(out.killed, false);
  });

  it('NEVER throws when eviction itself throws — surfaces the error, kills nothing', async () => {
    // A non-string configDir makes `join()` inside evictProfileSquatters throw. The contract is
    // that the error is REPORTED, never swallowed into an unguarded fallback kill.
    const out = await killProfileHolders('/p', {
      platform: 'linux',
      configDir: 42,
      exec: async () => ({ stdout: '' }),
    });
    assert.equal(out.killed, false);
    assert.ok(typeof out.error === 'string' && out.error.length > 0);
  });
});
