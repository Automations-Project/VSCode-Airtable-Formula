import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDetachedDaemonEnv } from '../src/daemon/launcher.js';

// The detached child IS the daemon, so a "don't use a daemon" instruction aimed at
// the parent must not survive into it. Everything else the host chose — including
// how the browser is allowed to appear on screen — must.
describe('buildDetachedDaemonEnv', () => {
  it('drops AIRTABLE_NO_DAEMON — the child is the daemon and would refuse to be one', () => {
    const env = buildDetachedDaemonEnv('/cfg', { AIRTABLE_NO_DAEMON: '1' });
    assert.strictEqual(env.AIRTABLE_NO_DAEMON, undefined);
  });

  it('inherits AIRTABLE_HEADLESS_ONLY — a respawn must not pop a visible browser window', () => {
    const env = buildDetachedDaemonEnv('/cfg', { AIRTABLE_HEADLESS_ONLY: '1' });
    assert.strictEqual(
      env.AIRTABLE_HEADLESS_ONLY,
      '1',
      'the extension sets AIRTABLE_HEADLESS_ONLY=1 for every daemon it owns; dropping it on respawn puts a Chrome window on the user\'s screen',
    );
  });

  it('leaves AIRTABLE_HEADLESS_ONLY absent when the parent never set it', () => {
    const env = buildDetachedDaemonEnv('/cfg', { PATH: '/usr/bin' });
    assert.strictEqual(env.AIRTABLE_HEADLESS_ONLY, undefined);
  });

  it('pins AIRTABLE_USER_MCP_HOME to the requested configDir, overriding any inherited value', () => {
    const env = buildDetachedDaemonEnv('/cfg', { AIRTABLE_USER_MCP_HOME: '/somewhere/else' });
    assert.strictEqual(env.AIRTABLE_USER_MCP_HOME, '/cfg');
  });

  it('passes every other variable through untouched', () => {
    const env = buildDetachedDaemonEnv('/cfg', {
      PATH: '/usr/bin',
      AIRTABLE_AUTH_MODE: 'byo',
      AIRTABLE_HTTP_CLIENT: 'impit',
      HTTPS_PROXY: 'http://proxy:8080',
    });
    assert.strictEqual(env.PATH, '/usr/bin');
    assert.strictEqual(env.AIRTABLE_AUTH_MODE, 'byo');
    assert.strictEqual(env.AIRTABLE_HTTP_CLIENT, 'impit');
    assert.strictEqual(env.HTTPS_PROXY, 'http://proxy:8080');
  });

  it('does not mutate the environment it was handed', () => {
    const base = { AIRTABLE_NO_DAEMON: '1', AIRTABLE_HEADLESS_ONLY: '1' };
    buildDetachedDaemonEnv('/cfg', base);
    assert.strictEqual(base.AIRTABLE_NO_DAEMON, '1');
    assert.strictEqual(base.AIRTABLE_HEADLESS_ONLY, '1');
  });
});
