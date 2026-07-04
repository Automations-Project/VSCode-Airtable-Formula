import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadByoCredentials, scrapeCsrf, getCredentialsPath } from '../src/byo-credentials.js';
import { setInjectedCredentials, clearInjectedCredentials } from '../src/daemon/cred-store.js';

/**
 * BYO (bring-your-own) cookie credentials for AIRTABLE_AUTH_MODE=byo.
 * Pure/injectable: the csrf-scrape GET goes through an injected fetchImpl so
 * these tests never touch the network.
 */

// Save/restore the env keys these tests mutate.
const ENV_KEYS = ['AIRTABLE_COOKIE', 'AIRTABLE_CSRF', 'AIRTABLE_USER_MCP_HOME'];
function snapshotEnv() {
  const s = {};
  for (const k of ENV_KEYS) s[k] = process.env[k];
  return s;
}
function restoreEnv(s) {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k];
  }
}

const HTML_WITH_CSRF = '<html><head><script>window.__INIT__={"csrfToken":"SCRAPED-CSRF-42","x":1}</script></head></html>';

describe('scrapeCsrf', () => {
  it('finds a csrfToken in a script/window JSON blob', () => {
    assert.equal(scrapeCsrf(HTML_WITH_CSRF), 'SCRAPED-CSRF-42');
  });
  it('finds a csrfToken in a meta tag (name-first)', () => {
    assert.equal(scrapeCsrf('<meta name="csrf-token" content="META-CSRF">'), 'META-CSRF');
  });
  it('finds a csrfToken in a meta tag (content-first)', () => {
    assert.equal(scrapeCsrf('<meta content="META-CSRF2" name="csrf-token">'), 'META-CSRF2');
  });
  it('returns null when nothing matches or input is empty', () => {
    assert.equal(scrapeCsrf('<html>nope</html>'), null);
    assert.equal(scrapeCsrf(''), null);
    assert.equal(scrapeCsrf(null), null);
  });
});

describe('loadByoCredentials', () => {
  let env, tmpHome;
  beforeEach(() => {
    env = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'byo-'));
    process.env.AIRTABLE_USER_MCP_HOME = tmpHome;
  });
  afterEach(() => {
    restoreEnv(env);
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('env source: AIRTABLE_COOKIE + AIRTABLE_CSRF (no fetch, no scrape)', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=1; __Host-airtable-session=abc';
    process.env.AIRTABLE_CSRF = 'ENV-CSRF';
    let fetched = false;
    const creds = await loadByoCredentials({ fetchImpl: async () => { fetched = true; return { text: async () => '' }; } });
    assert.equal(creds.cookieHeader, 'brw=1; __Host-airtable-session=abc');
    assert.equal(creds.csrfToken, 'ENV-CSRF');
    assert.equal(fetched, false);
  });

  it('env source without csrf: scrapes csrf from a GET of airtable.com carrying the cookie', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=9';
    let seenReq;
    const creds = await loadByoCredentials({
      fetchImpl: async (url, opts) => { seenReq = { url, opts }; return { text: async () => HTML_WITH_CSRF }; },
    });
    assert.equal(creds.cookieHeader, 'brw=9');
    assert.equal(creds.csrfToken, 'SCRAPED-CSRF-42');
    assert.equal(seenReq.url, 'https://airtable.com/');
    assert.equal(seenReq.opts.headers.Cookie, 'brw=9');
  });

  it('file source: reads cookie + csrf from ~/.airtable-user-mcp/credentials.json', async () => {
    fs.writeFileSync(getCredentialsPath(), JSON.stringify({ cookie: 'brw=file; sess=x', csrf: 'FILE-CSRF' }));
    const creds = await loadByoCredentials({ fetchImpl: async () => { throw new Error('should not fetch'); } });
    assert.equal(creds.cookieHeader, 'brw=file; sess=x');
    assert.equal(creds.csrfToken, 'FILE-CSRF');
  });

  it('file source without csrf: scrapes it', async () => {
    fs.writeFileSync(getCredentialsPath(), JSON.stringify({ cookie: 'brw=file2' }));
    const creds = await loadByoCredentials({ fetchImpl: async () => ({ text: async () => HTML_WITH_CSRF }) });
    assert.equal(creds.cookieHeader, 'brw=file2');
    assert.equal(creds.csrfToken, 'SCRAPED-CSRF-42');
  });

  it('env takes precedence over the file', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=env';
    process.env.AIRTABLE_CSRF = 'ENV-WINS';
    fs.writeFileSync(getCredentialsPath(), JSON.stringify({ cookie: 'brw=file', csrf: 'FILE-LOSES' }));
    const creds = await loadByoCredentials();
    assert.equal(creds.cookieHeader, 'brw=env');
    assert.equal(creds.csrfToken, 'ENV-WINS');
  });

  it('csrf null (not fatal) when neither supplied nor scrapable', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=1';
    const creds = await loadByoCredentials({ fetchImpl: async () => ({ text: async () => '<html>no token here</html>' }) });
    assert.equal(creds.cookieHeader, 'brw=1');
    assert.equal(creds.csrfToken, null);
  });

  it('csrf null when the scrape GET throws (network error is non-fatal)', async () => {
    process.env.AIRTABLE_COOKIE = 'brw=1';
    const creds = await loadByoCredentials({ fetchImpl: async () => { throw new Error('net down'); } });
    assert.equal(creds.csrfToken, null);
  });

  it('throws an actionable error when no cookie is available anywhere', async () => {
    await assert.rejects(() => loadByoCredentials(), /BYO_CREDENTIALS_MISSING/);
  });

  it('throws on an invalid JSON credentials file', async () => {
    fs.writeFileSync(getCredentialsPath(), '{not json');
    await assert.rejects(() => loadByoCredentials(), /not valid JSON/);
  });
});

describe('loadByoCredentials — injected in-memory store (daemon runtime channel)', () => {
  let env, tmpHome;
  beforeEach(() => {
    env = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'byo-inj-'));
    process.env.AIRTABLE_USER_MCP_HOME = tmpHome;
    clearInjectedCredentials();
  });
  afterEach(() => {
    restoreEnv(env);
    fs.rmSync(tmpHome, { recursive: true, force: true });
    clearInjectedCredentials();
  });

  it('injected cookie + csrf wins over both env AND file (no fetch/scrape)', async () => {
    // Env AND file both present — the injected store must still win.
    process.env.AIRTABLE_COOKIE = 'brw=env';
    process.env.AIRTABLE_CSRF = 'ENV-CSRF';
    fs.writeFileSync(getCredentialsPath(), JSON.stringify({ cookie: 'brw=file', csrf: 'FILE-CSRF' }));
    setInjectedCredentials({ authMode: 'byo', cookie: 'brw=injected', csrf: 'INJECTED-CSRF' });

    let fetched = false;
    const creds = await loadByoCredentials({ fetchImpl: async () => { fetched = true; return { text: async () => '' }; } });
    assert.equal(creds.cookieHeader, 'brw=injected');
    assert.equal(creds.csrfToken, 'INJECTED-CSRF');
    assert.equal(fetched, false); // csrf supplied → no scrape
  });

  it('injected cookie without csrf → scrapes csrf (carrying the injected cookie)', async () => {
    setInjectedCredentials({ authMode: 'byo', cookie: 'brw=injected2' });
    let seenReq;
    const creds = await loadByoCredentials({
      fetchImpl: async (url, opts) => { seenReq = { url, opts }; return { text: async () => HTML_WITH_CSRF }; },
    });
    assert.equal(creds.cookieHeader, 'brw=injected2');
    assert.equal(creds.csrfToken, 'SCRAPED-CSRF-42');
    assert.equal(seenReq.opts.headers.Cookie, 'brw=injected2');
  });

  it('empty injected store → falls back to env (existing behavior unchanged)', async () => {
    // Store cleared in beforeEach; a blank cookie must not be treated as a hit.
    setInjectedCredentials({ authMode: 'byo', cookie: '   ' });
    process.env.AIRTABLE_COOKIE = 'brw=env-fallback';
    process.env.AIRTABLE_CSRF = 'ENV-FALLBACK-CSRF';
    const creds = await loadByoCredentials();
    assert.equal(creds.cookieHeader, 'brw=env-fallback');
    assert.equal(creds.csrfToken, 'ENV-FALLBACK-CSRF');
  });

  it('no injected cookie field → falls back to file', async () => {
    setInjectedCredentials({ authMode: 'byo', csrf: 'ORPHAN-CSRF' }); // csrf but no cookie
    fs.writeFileSync(getCredentialsPath(), JSON.stringify({ cookie: 'brw=file-fallback', csrf: 'FILE-CSRF' }));
    const creds = await loadByoCredentials({ fetchImpl: async () => { throw new Error('should not fetch'); } });
    assert.equal(creds.cookieHeader, 'brw=file-fallback');
    assert.equal(creds.csrfToken, 'FILE-CSRF');
  });
});
