import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableAuth } from '../src/auth.js';

// Regression: a hung browser (re)launch (launchPersistentContext on a locked/contended
// .chrome-profile) must NOT block forever. Before _doInitBounded, init()/_recoverSession
// awaited an unbounded _doInit(), so one hung relaunch froze the serialized request queue
// indefinitely (records apply stuck after 1 record for hours). The bounded wrapper rejects.
describe('AirtableAuth — bounded init/recovery (no infinite hang on a locked profile)', () => {
  function withShortTimeout(fn) {
    const prev = process.env.AIRTABLE_INIT_TIMEOUT_MS;
    process.env.AIRTABLE_INIT_TIMEOUT_MS = '50';
    return Promise.resolve(fn()).finally(() => {
      if (prev === undefined) delete process.env.AIRTABLE_INIT_TIMEOUT_MS;
      else process.env.AIRTABLE_INIT_TIMEOUT_MS = prev;
    });
  }

  it('init() rejects within the timeout when _doInit hangs', () => withShortTimeout(async () => {
    const auth = new AirtableAuth();
    // Simulate a hung launchPersistentContext, but keep the resolver so we can settle it after the
    // assertion — a never-resolving `new Promise(() => {})` stays pending forever and, in a multi-file
    // run, trips node:test's "Promise resolution is still pending" and cancels later suites.
    let releaseHang;
    auth._doInit = () => new Promise((resolve) => { releaseHang = resolve; });
    await assert.rejects(() => auth.init(), /exceeded .* the browser profile may be locked/);
    releaseHang(); // settle the simulated hung launch so its promise does not leak past this test
  }));

  it('_recoverSession() rejects within the timeout and resets _recovering (queue not permanently blocked)', () => withShortTimeout(async () => {
    const auth = new AirtableAuth();
    let releaseHang;
    auth._doInit = () => new Promise((resolve) => { releaseHang = resolve; });
    await assert.rejects(() => auth._recoverSession(), /exceeded/);
    assert.equal(auth._recovering, false); // flag reset so subsequent calls can proceed
    releaseHang();
  }));

  it('init() still succeeds normally when _doInit resolves promptly', () => withShortTimeout(async () => {
    const auth = new AirtableAuth();
    let called = 0;
    auth._doInit = async () => { called++; };
    await auth.init();
    assert.equal(called, 1);
  }));

  // Regression: on a watchdog timeout the caller rejects, but the hung _doInit
  // (launchPersistentContext) keeps running detached. A retry MUST re-attach to that
  // in-flight launch, not start a SECOND Chromium on the MCP-EXCLUSIVE .chrome-profile.
  it('a retry after a watchdog timeout reuses the in-flight _doInit (no second launch)', () => withShortTimeout(async () => {
    const auth = new AirtableAuth();
    let calls = 0;
    const resolvers = [];
    auth._doInit = () => { calls++; return new Promise((resolve) => resolvers.push(resolve)); };

    await assert.rejects(() => auth.init(), /exceeded/); // first attempt times out
    await assert.rejects(() => auth.init(), /exceeded/); // retry while _doInit is still in flight

    assert.equal(calls, 1, 'the retry must re-attach to the running _doInit, not launch a second Chromium');

    resolvers.forEach((r) => r()); // settle the hung launch(es) so nothing leaks past the test
  }));

  // A _doInit that completes AFTER the watchdog already timed out has produced a valid session —
  // its context must be kept for the next (re-attaching) call, never force-closed by the timed-out
  // attempt (idle-park frees an unused warm browser's RSS; a failed _doInit closes its own context).
  it('a _doInit that succeeds after the watchdog timeout keeps its context (not force-closed)', () => withShortTimeout(async () => {
    const auth = new AirtableAuth();
    let finish;
    const fakeCtx = { closed: false, close: async () => { fakeCtx.closed = true; } };
    auth._doInit = () => new Promise((resolve) => {
      finish = () => { auth.context = fakeCtx; resolve(); };
    });

    await assert.rejects(() => auth.init(), /exceeded/); // times out
    finish();                                            // _doInit completes late, sets a live context
    await new Promise((r) => setTimeout(r, 10));         // let late handlers run

    assert.equal(fakeCtx.closed, false, 'a successfully-launched context must survive for the next call');
  }));
});
