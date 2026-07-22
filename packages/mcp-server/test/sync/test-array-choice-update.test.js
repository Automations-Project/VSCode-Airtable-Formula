/**
 * multiSelect / multiCollaborator UPDATE path:
 * collectArrayChoiceUpdates + client.setArrayChoiceCell (add/remove item APIs).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectArrayChoiceUpdates, buildUpdateCells } from '../../src/sync/records.js';
import { AirtableClient } from '../../src/client.js';

describe('collectArrayChoiceUpdates', () => {
  const idmap = {
    fields: {
      fTags: {
        destFld: 'fTagsD',
        choices: { selA: 'selAD', selB: 'selBD', selC: 'selCD' },
      },
      fCollab: { destFld: 'fCollabD', choices: {} },
      fName: { destFld: 'fNameD', choices: {} },
    },
  };
  const fields = [
    { id: 'fTags', type: 'multiSelect' },
    { id: 'fCollab', type: 'multiCollaborator' },
    { id: 'fName', type: 'text' },
  ];

  it('emits a remapped multiSelect op when dest differs', () => {
    const ops = collectArrayChoiceUpdates(
      fields,
      { fTags: ['selA', 'selC'] },
      { fTagsD: ['selAD', 'selBD'] },
      idmap,
    );
    assert.equal(ops.length, 1);
    assert.equal(ops[0].columnId, 'fTagsD');
    assert.deepEqual(ops[0].desiredIds.sort(), ['selAD', 'selCD'].sort());
    assert.deepEqual(ops[0].currentIds.sort(), ['selAD', 'selBD'].sort());
  });

  it('skips multiSelect when already converged (order-insensitive)', () => {
    const ops = collectArrayChoiceUpdates(
      fields,
      { fTags: ['selB', 'selA'] },
      { fTagsD: ['selAD', 'selBD'] },
      idmap,
    );
    assert.equal(ops.length, 0);
  });

  it('clears multiSelect when source cell is empty', () => {
    const ops = collectArrayChoiceUpdates(
      fields,
      {}, // cleared on source
      { fTagsD: ['selAD'] },
      idmap,
    );
    assert.equal(ops.length, 1);
    assert.deepEqual(ops[0].desiredIds, []);
    assert.deepEqual(ops[0].currentIds, ['selAD']);
  });

  it('passes collaborator usr ids through without choice map', () => {
    const ops = collectArrayChoiceUpdates(
      fields,
      { fCollab: ['usrAAA', 'usrBBB'] },
      { fCollabD: ['usrAAA'] },
      idmap,
    );
    assert.equal(ops.length, 1);
    assert.deepEqual(ops[0].desiredIds.sort(), ['usrAAA', 'usrBBB'].sort());
  });

  it('does not put multiSelect into buildUpdateCells primitive map', () => {
    const warnings = [];
    const cells = buildUpdateCells(
      fields,
      { fTags: ['selA'], fName: 'hello' },
      { fTagsD: ['selBD'], fNameD: 'old' },
      idmap,
      warnings,
      'recS',
    );
    assert.equal(cells.fNameD, 'hello');
    assert.equal(cells.fTagsD, undefined);
    assert.equal(warnings.filter((w) => w.code === 'RECORD_ARRAY_UPDATE_DEFERRED').length, 0);
  });
});

describe('AirtableClient.setArrayChoiceCell', () => {
  it('removes then adds to converge membership', async () => {
    const calls = [];
    const auth = {
      postForm: async (url, params) => {
        calls.push({ url, params });
        return { ok: true, status: 200, text: async () => '{}' };
      },
      csrfToken: 'c',
    };
    const client = new AirtableClient(auth);
    client._mutationParams = (payload) => payload; // bypass csrf packaging for test

    const res = await client.setArrayChoiceCell(
      'appAAA',
      'recBBB',
      'fldCCC',
      ['selNew', 'selKeep'],
      { currentIds: ['selOld', 'selKeep'] },
    );
    assert.equal(res.ok, true);
    assert.equal(res.removed, 1);
    assert.equal(res.added, 1);
    assert.ok(calls[0].url.includes('updateArrayTypeCellByRemovingItem'));
    assert.equal(calls[0].params.item, 'selOld');
    assert.ok(calls[1].url.includes('updateArrayTypeCellByAddingItem'));
    assert.equal(calls[1].params.item, 'selNew');
  });

  it('no-ops when already equal', async () => {
    const calls = [];
    const auth = {
      postForm: async (url, params) => {
        calls.push({ url, params });
        return { ok: true, status: 200, text: async () => '{}' };
      },
    };
    const client = new AirtableClient(auth);
    client._mutationParams = (p) => p;
    const res = await client.setArrayChoiceCell('appA', 'recB', 'fldC', ['a', 'b'], {
      currentIds: ['b', 'a'],
    });
    assert.equal(res.ok, true);
    assert.equal(res.added, 0);
    assert.equal(res.removed, 0);
    assert.equal(calls.length, 0);
  });
});
