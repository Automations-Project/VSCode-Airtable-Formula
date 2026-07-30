import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableClient } from '../src/client.js';

describe('setViewColumns: _showColumnsWithRetry', () => {
  it('retries columns that did not take on the first show, until read-back confirms all', async () => {
    const c = new AirtableClient({}); // dummy auth; helper only uses showOrHideColumns + getView
    const shown = new Set();
    let calls = 0;
    // Simulate bulk under-apply: first show only takes 1 column; retries take the rest.
    c.showOrHideColumns = async (_a, _v, ids) => { calls++; if (calls === 1) shown.add(ids[0]); else ids.forEach((id) => shown.add(id)); return {}; };
    c.getView = async () => ({ columnOrder: ['fA', 'fB', 'fC'].map((id) => ({ columnId: id, visibility: shown.has(id) })) });
    const n = await c._showColumnsWithRetry('app', 'viw', ['fA', 'fB', 'fC']);
    assert.equal(n, 3);        // all confirmed visible
    assert.ok(calls >= 2);     // it retried the un-shown set
  });

  it('returns best-effort count if some columns never take (no infinite loop)', async () => {
    const c = new AirtableClient({});
    c.showOrHideColumns = async () => ({});
    c.getView = async () => ({ columnOrder: [{ columnId: 'fA', visibility: true }, { columnId: 'fB', visibility: false }] }); // fB never shows
    const n = await c._showColumnsWithRetry('app', 'viw', ['fA', 'fB'], 2);
    assert.equal(n, 1); // only fA confirmed; bounded by maxAttempts
  });

  it('treats a column with no visibility key as visible — matches getView semantics, resolves in one round-trip', async () => {
    // getView's own filter is `c && c.visibility !== false`, so an absent
    // `visibility` key means visible. The retry helper's confirmation check must
    // agree, or a column the API reports back WITHOUT a visibility key (common
    // for a freshly-shown column) never reads as confirmed and the helper burns
    // every attempt (5 * 400ms) before giving up with a wrong best-effort count.
    const c = new AirtableClient({});
    let calls = 0;
    c.showOrHideColumns = async () => { calls++; return {}; };
    c.getView = async () => ({ columnOrder: [{ columnId: 'fA' }, { columnId: 'fB' }] }); // no `visibility` key at all
    const n = await c._showColumnsWithRetry('app', 'viw', ['fA', 'fB']);
    assert.equal(n, 2);      // both confirmed visible
    assert.equal(calls, 1);  // must not retry — confirmed on the first read-back
  });
});
