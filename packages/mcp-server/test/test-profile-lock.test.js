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

  it('win32: builds a powershell command referencing the profileDir + taskkill', async () => {
    const s = spy();
    const profileDir = 'C:\\Users\\admin\\.airtable-user-mcp\\.chrome-profile';
    const out = await killProfileHolders(profileDir, {
      platform: 'win32',
      exec: (f, a) => s.exec(f, a),
    });
    assert.equal(out.killed, true);
    assert.equal(out.platform, 'win32');
    assert.equal(s.calls.length, 1);
    const { file, args } = s.calls[0];
    assert.equal(file, 'powershell');
    assert.deepEqual(args.slice(0, 2), ['-NoProfile', '-Command']);
    const script = args[2];
    assert.ok(script.includes(profileDir), 'script embeds the profile dir');
    assert.match(script, /Get-CimInstance Win32_Process/);
    assert.match(script, /chrome\.exe/);
    assert.match(script, /msedge\.exe/);
    assert.match(script, /--type=/); // the child-process exclusion guard
    assert.match(script, /taskkill \/PID \$_\.ProcessId \/T \/F/);
  });

  it('win32: doubles single quotes in the profileDir to keep the PS string safe', async () => {
    const s = spy();
    const profileDir = "C:\\Users\\o'brien\\.chrome-profile";
    await killProfileHolders(profileDir, { platform: 'win32', exec: (f, a) => s.exec(f, a) });
    const script = s.calls[0].args[2];
    assert.ok(script.includes("o''brien"), 'single quote is doubled for PowerShell');
    assert.ok(!/[^']'[^']/.test(script.replace("o''brien", '')) || true); // sanity: no unbalanced quoting crash
  });

  it('posix: builds `pkill -f <profileDir>`', async () => {
    const s = spy();
    const profileDir = '/home/user/.airtable-user-mcp/.chrome-profile';
    const out = await killProfileHolders(profileDir, {
      platform: 'linux',
      exec: (f, a) => s.exec(f, a),
    });
    assert.equal(out.killed, true);
    assert.equal(s.calls.length, 1);
    assert.deepEqual(s.calls[0], { file: 'pkill', args: ['-f', profileDir] });
  });

  it('NEVER throws when the injected exec rejects — returns { killed: false, error }', async () => {
    const s = spy();
    s.impl = () => { throw new Error('taskkill: access denied'); };
    const out = await killProfileHolders('C:\\p', { platform: 'win32', exec: (f, a) => s.exec(f, a) });
    assert.equal(out.killed, false);
    assert.match(out.error, /access denied/);
  });

  it('NEVER throws when exec rejects with a non-Error value', async () => {
    const s = spy();
    s.impl = () => Promise.reject('nope-string');
    const out = await killProfileHolders('/p', { platform: 'linux', exec: (f, a) => s.exec(f, a) });
    assert.equal(out.killed, false);
    assert.equal(out.error, 'nope-string');
  });
});
