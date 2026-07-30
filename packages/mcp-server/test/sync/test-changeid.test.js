import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computePlan } from '../../src/sync/diff.js';

// Minimal snapshot helpers
function makeSnap(baseId, tables) {
  return { baseId, tables };
}

test('computePlan actions carry stable name-based changeId + class + apply', () => {
  const src = makeSnap('a', [{
    id: 'tS', name: 'Offers', primaryFieldId: 'p',
    fields: [
      { id: 'p', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
      { id: 'f', name: 'Price', type: 'number', typeOptions: null, description: null, isComputed: false },
    ],
    views: [],
  }]);
  const dest = makeSnap('b', []);
  const idmap = { tables: {}, fields: {}, views: {} };

  const p1 = computePlan(src, dest, idmap);
  const cf = p1.actions.find(a => a.kind === 'createField' && a.name === 'Price');
  assert.ok(cf, 'createField for Price should exist');
  assert.equal(cf.changeId, 'createField|Offers|Price');
  assert.equal(cf.class, 'drift');
  assert.equal(cf.apply, true);

  // stability across a second identical run
  const p2 = computePlan(src, dest, idmap);
  assert.deepEqual(p1.actions.map(a => a.changeId), p2.actions.map(a => a.changeId));
});

test('createTable action gets stable changeId', () => {
  const src = makeSnap('a', [{
    id: 'tS', name: 'Projects', primaryFieldId: 'p',
    fields: [{ id: 'p', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false }],
    views: [],
  }]);
  const dest = makeSnap('b', []);
  const idmap = { tables: {}, fields: {}, views: {} };

  const plan = computePlan(src, dest, idmap);
  const ct = plan.actions.find(a => a.kind === 'createTable');
  assert.ok(ct, 'createTable action should exist');
  assert.equal(ct.changeId, 'createTable|Projects|Projects');
  assert.equal(ct.class, 'drift');
  assert.equal(ct.apply, true);
});

test('reconcilePrimary action gets stable changeId', () => {
  const src = makeSnap('a', [{
    id: 'tS', name: 'Projects', primaryFieldId: 'p',
    fields: [{ id: 'p', name: 'Title', type: 'text', typeOptions: null, description: null, isComputed: false }],
    views: [],
  }]);
  const dest = makeSnap('b', []);
  const idmap = { tables: {}, fields: {}, views: {} };

  const plan = computePlan(src, dest, idmap);
  const rp = plan.actions.find(a => a.kind === 'reconcilePrimary');
  assert.ok(rp, 'reconcilePrimary action should exist');
  assert.equal(rp.changeId, 'reconcilePrimary|Projects|Projects');
  assert.equal(rp.class, 'drift');
  assert.equal(rp.apply, true);
});

test('updateField action (no sourceTableId) gets table-qualified changeId via srcFieldId lookup', () => {
  // src and dest have same table (matched via idmap), but field type differs
  const src = makeSnap('a', [{
    id: 'tS', name: 'Orders', primaryFieldId: 'p',
    fields: [
      { id: 'p', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
      { id: 'fA', name: 'Amount', type: 'number', typeOptions: null, description: null, isComputed: false },
    ],
    views: [],
  }]);
  const dest = makeSnap('b', [{
    id: 'tD', name: 'Orders', primaryFieldId: 'dp',
    fields: [
      { id: 'dp', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false },
      { id: 'dfA', name: 'Amount', type: 'text', typeOptions: null, description: null, isComputed: false }, // type differs
    ],
    views: [],
  }]);
  const idmap = {
    tables: { tS: 'tD' },
    fields: { fA: { destFld: 'dfA', choices: {} } },
    views: {},
  };

  const plan = computePlan(src, dest, idmap);
  const uf = plan.actions.find(a => a.kind === 'updateField');
  assert.ok(uf, 'updateField action should exist');
  // updateField has no sourceTableId — must resolve table from sourceFieldId
  assert.equal(uf.changeId, 'updateField|Orders|Amount');
  assert.equal(uf.class, 'drift');
  assert.equal(uf.apply, true);
});

test('applyViewConfig action (no name field) gets view-name-qualified changeId', () => {
  const src = makeSnap('a', [{
    id: 'tS', name: 'Tasks', primaryFieldId: 'p',
    fields: [{ id: 'p', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false }],
    views: [{
      id: 'vS', name: 'My Grid', type: 'grid', personalForUserId: null,
      config: { filters: [], sorts: [], groups: [] },
    }],
  }]);
  const dest = makeSnap('b', [{
    id: 'tD', name: 'Tasks', primaryFieldId: 'dp',
    fields: [{ id: 'dp', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false }],
    views: [], // no views — force createView + applyViewConfig
  }]);
  const idmap = {
    tables: { tS: 'tD' },
    fields: {},
    views: {},
  };

  const plan = computePlan(src, dest, idmap);
  const avc = plan.actions.find(a => a.kind === 'applyViewConfig');
  assert.ok(avc, 'applyViewConfig action should exist');
  assert.equal(avc.changeId, 'applyViewConfig|Tasks|My Grid');
  assert.equal(avc.class, 'drift');
  assert.equal(avc.apply, true);
});

test('createView action gets correct changeId', () => {
  const src = makeSnap('a', [{
    id: 'tS', name: 'Tasks', primaryFieldId: 'p',
    fields: [{ id: 'p', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false }],
    views: [{
      id: 'vS', name: 'Kanban Board', type: 'kanban', personalForUserId: null,
      config: {},
    }],
  }]);
  const dest = makeSnap('b', [{
    id: 'tD', name: 'Tasks', primaryFieldId: 'dp',
    fields: [{ id: 'dp', name: 'Name', type: 'text', typeOptions: null, description: null, isComputed: false }],
    views: [],
  }]);
  const idmap = {
    tables: { tS: 'tD' },
    fields: {},
    views: {},
  };

  const plan = computePlan(src, dest, idmap);
  const cv = plan.actions.find(a => a.kind === 'createView');
  assert.ok(cv, 'createView action should exist');
  assert.equal(cv.changeId, 'createView|Tasks|Kanban Board');
  assert.equal(cv.class, 'drift');
  assert.equal(cv.apply, true);
});
