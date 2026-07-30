import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setInjectedCredentials,
  getInjectedCredentials,
  clearInjectedCredentials,
} from '../src/daemon/cred-store.js';

/**
 * In-memory injected credential store (SECURITY-CRITICAL): the daemon's runtime
 * credential channel. These tests assert the set/get/clear contract and that
 * the store returns COPIES (mutating a get() result never corrupts the store).
 */

describe('cred-store', () => {
  afterEach(() => clearInjectedCredentials());

  it('starts empty (getInjectedCredentials returns null)', () => {
    clearInjectedCredentials();
    assert.equal(getInjectedCredentials(), null);
  });

  it('set → get round-trips every field', () => {
    const creds = {
      authMode: 'byo',
      cookie: 'brw=1; __Host-airtable-session=abc',
      csrf: 'CSRF-1',
      email: 'user@example.com',
      password: 'hunter2',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    };
    setInjectedCredentials(creds);
    assert.deepEqual(getInjectedCredentials(), creds);
  });

  it('clear nulls the store', () => {
    setInjectedCredentials({ authMode: 'byo', cookie: 'brw=1' });
    assert.ok(getInjectedCredentials());
    clearInjectedCredentials();
    assert.equal(getInjectedCredentials(), null);
  });

  it('a later set replaces the previous credentials wholesale', () => {
    setInjectedCredentials({ authMode: 'byo', cookie: 'brw=first' });
    setInjectedCredentials({ authMode: 'direct-login', email: 'e@x.com', password: 'p' });
    const out = getInjectedCredentials();
    assert.equal(out.authMode, 'direct-login');
    assert.equal(out.email, 'e@x.com');
    assert.equal(out.cookie, undefined); // not carried over from the first set
  });

  it('set stores a copy — mutating the caller object does not reach the store', () => {
    const input = { authMode: 'byo', cookie: 'brw=orig' };
    setInjectedCredentials(input);
    input.cookie = 'brw=TAMPERED';
    assert.equal(getInjectedCredentials().cookie, 'brw=orig');
  });

  it('get returns a copy — mutating the result does not corrupt the store', () => {
    setInjectedCredentials({ authMode: 'byo', cookie: 'brw=orig' });
    const first = getInjectedCredentials();
    first.cookie = 'brw=TAMPERED';
    assert.equal(getInjectedCredentials().cookie, 'brw=orig');
  });

  it('null / undefined / non-object clears the store', () => {
    setInjectedCredentials({ authMode: 'byo', cookie: 'brw=1' });
    setInjectedCredentials(null);
    assert.equal(getInjectedCredentials(), null);

    setInjectedCredentials({ authMode: 'byo', cookie: 'brw=1' });
    setInjectedCredentials(undefined);
    assert.equal(getInjectedCredentials(), null);

    setInjectedCredentials({ authMode: 'byo', cookie: 'brw=1' });
    setInjectedCredentials('not-an-object');
    assert.equal(getInjectedCredentials(), null);
  });
});
