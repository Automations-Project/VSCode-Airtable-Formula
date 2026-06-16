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
});
