import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * `airtable-user-mcp logout` used to delete the Chrome profile directory and
 * nothing else. Two consequences, both of which tell the user the opposite of
 * the truth:
 *
 *   1. A running daemon was never touched. It holds the session in memory
 *      (browser mode: a live Chromium; byo/direct-login: the cred-store), so
 *      every MCP tool call kept working after "Browser session cleared."
 *   2. `fs.rm(..., { force: true })` does NOT throw on a missing directory, so
 *      the catch branch only ran on a REAL failure — typically EBUSY on Windows
 *      because the daemon's Chromium still held the profile open. It printed
 *      "No session to clear.", i.e. exactly wrong: the session was still there.
 *
 * Driven as a child process (the real `node src/index.js logout` entry point) so
 * stdout capture never fights the test runner's own reporter.
 */

const ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'atmcp-logout-'));
const PROFILE = path.join(HOME, '.chrome-profile');
const LOCK = path.join(HOME, 'daemon.lock');

function logout() {
  return execFileSync(process.execPath, [ENTRY, 'logout'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      AIRTABLE_USER_MCP_HOME: HOME,
      AIRTABLE_PROFILE_DIR: PROFILE,
    },
  });
}

before(() => {
  // Sanity: the entry point must exist, otherwise every assertion below is vacuous.
  assert.equal(fs.existsSync(ENTRY), true);
});

after(() => fs.rmSync(HOME, { recursive: true, force: true }));

beforeEach(() => {
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.writeFileSync(path.join(PROFILE, 'Cookies'), 'session-cookie-bytes');
  fs.rmSync(LOCK, { force: true });
});

describe('cli logout', () => {
  it('clears the profile and says so', () => {
    const out = logout();
    assert.equal(fs.existsSync(PROFILE), false, 'the browser profile must be gone');
    assert.match(out, /Browser session cleared/);
  });

  it('engages the daemon: a stale lock is reclaimed instead of left serving', () => {
    // A lockfile whose pid is dead is exactly what a crashed/leaked daemon leaves
    // behind. The OLD logout ignored the daemon entirely, so this file survived;
    // the fixed one routes through stopDaemon({force:true}), which reclaims it.
    // Port 1 refuses instantly, so the health probe returns without waiting.
    fs.writeFileSync(LOCK, JSON.stringify({
      pid: 999999,                 // not a live process
      uuid: 'test-uuid-0000',
      port: 1,
      port_lsp: null,
      bearerToken: 'tok',
      version: '0.0.0-test',
      startedAt: new Date().toISOString(),
      tunnelUrl: null,
    }));

    logout();
    assert.equal(fs.existsSync(LOCK), false, 'logout must go through the daemon, not around it');
  });

  it('an already-clean profile is not reported as a failure', () => {
    fs.rmSync(PROFILE, { recursive: true, force: true });
    const out = logout();          // execFileSync throws on a non-zero exit
    assert.match(out, /Browser session cleared/);
  });

  it('does NOT claim "no session to clear" when the removal actually failed', () => {
    // force:true already swallows ENOENT, so the catch branch means a genuine
    // failure — the session is still on disk and the message must say that.
    // Asserted on the source because forcing a portable EBUSY (Windows) /
    // EACCES (POSIX) removal failure is not reproducible across platforms.
    const src = fs.readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf("cmd === 'logout'"), src.indexOf("cmd === 'install-browser'"));
    // Matches what is PRINTED, not prose: the explanatory comment quotes the old
    // wording on purpose.
    assert.doesNotMatch(block, /write\(\s*'No session to clear/);
    assert.match(block, /Could not clear the browser session/);
    assert.match(block, /stopDaemon/);
  });
});
