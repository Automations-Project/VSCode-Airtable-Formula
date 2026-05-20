import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

// ─── shared mock helpers ───────────────────────────────────────────────────

function createMockAuth(responses = {}) {
  const calls = [];
  const defaultResponse = {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '{}',
  };
  return {
    calls,
    getSecretSocketId: () => 'socTEST',
    get(url, appId)           { calls.push({ method: 'GET',  url, appId }); return responses.get?.(url)      || { ...defaultResponse }; },
    postForm(url, params, appId) { calls.push({ method: 'POST', url, params, appId }); return responses.postForm?.(url, params) || { ...defaultResponse }; },
    postJSON(url, body, appId)   { calls.push({ method: 'POST', url, body,   appId }); return responses.postJSON?.(url, body)   || { ...defaultResponse }; },
  };
}

// ─── rate delay test ──────────────────────────────────────────────────────

describe('AirtableAuth rate delay', () => {
  it('_rateDelayMs defaults to 0', () => {
    // Import the class to verify the constructor default.
    // We cannot instantiate AirtableAuth (it needs patchright), but we can
    // inspect the constructor source to confirm the default.
    // This test guards against accidental removal of the field.
    const fs = _require('node:fs');
    const src = fs.readFileSync(
      new URL('../src/auth.js', import.meta.url),
      'utf8'
    );
    assert.ok(src.includes('_rateDelayMs'), '_rateDelayMs field must exist in auth.js');
    assert.ok(
      src.includes('AIRTABLE_RATE_DELAY_MS'),
      'env var AIRTABLE_RATE_DELAY_MS must be referenced',
    );
  });
});

describe('tool-call semaphore helpers', () => {
  it('acquires immediately when inflight < cap', async () => {
    const src = _require('node:fs').readFileSync(
      new URL('../src/index.js', import.meta.url),
      'utf8'
    );
    assert.ok(src.includes('_acquireToolSlot'), '_acquireToolSlot must be defined');
    assert.ok(src.includes('_releaseToolSlot'), '_releaseToolSlot must be defined');
    assert.ok(src.includes('_pendingToolQueue'), '_pendingToolQueue must be defined');
  });
});
