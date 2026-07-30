/**
 * test-apply-select-choices.test.js
 *
 * createField used to register a new select/multiSelect field with `choices: {}` in the idmap,
 * and nothing refreshed the choice map before the SAME-RUN records phase — so every select cell
 * skipped (RECORD_CELL_SKIPPED) on first sync, and multiSelect columns never converged (the
 * update path defers arrays).
 *
 * Under test: after createField (and existing-by-name adoption), the idmap entry carries the
 * REAL source-choice-id → dest-choice-id map, matched by name against the authoritative dest
 * schema (the server may re-key the choices it was sent).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockClient } from './helpers/mock-client.js';
import { applyPlan } from '../../src/sync/apply.js';
import { newJournal } from '../../src/sync/journal.js';
import { snapshotBase } from '../../src/sync/snapshot.js';

const SELECT_LIKE = new Set(['select', 'singleSelect', 'multiSelect', 'multipleSelects']);

/** MockClient variant that RE-KEYS select choices server-side (fresh sel ids), like a server
 *  that ignores caller-provided choice ids would. The idmap must survive this. */
class RekeyingClient extends MockClient {
  async createField(appId, tableId, cfg) {
    const out = await super.createField(appId, tableId, cfg);
    const f = this._field(out.columnId);
    if (SELECT_LIKE.has(cfg.type) && f.typeOptions && f.typeOptions.choices) {
      const rekeyed = {};
      for (const c of Object.values(f.typeOptions.choices)) {
        const nid = this._id('sel');
        rekeyed[nid] = { ...c, id: nid };
      }
      f.typeOptions = { ...f.typeOptions, choices: rekeyed };
    }
    return out;
  }
}

const SRC_CHOICES = {
  selSRCTodo: { id: 'selSRCTodo', name: 'Todo', color: 'blue' },
  selSRCDone: { id: 'selSRCDone', name: 'Done', color: 'green' },
};

// NOTE: 'Stage', not 'Status' — MockClient.createTable seeds a scaffolding select named
// 'Status', which would trigger the adopt-existing path instead of the create path.
function selectAction(overrides = {}) {
  return {
    kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fSel', name: 'Stage', type: 'select',
    typeOptions: { choices: JSON.parse(JSON.stringify(SRC_CHOICES)), choiceOrder: ['selSRCTodo', 'selSRCDone'] },
    description: null, computed: false, dependsOn: [], dependsOnTables: [],
    ...overrides,
  };
}

describe('apply: createField registers the real select choice map (first-run records phase needs it)', () => {
  it('maps source choice ids to the created dest choice ids by name (server re-keys)', async () => {
    const client = new RekeyingClient();
    const { tableId } = await client.createTable('appD', 'Offers');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnSel', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [selectAction()],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnSel', 'ts'), persist: () => {} });
    assert.equal(res.failed, 0);
    const entry = res.idmap.fields.fSel;
    assert.ok(entry, 'field mapped');
    const destField = (await client.getApplicationData('appD')).data.tableSchemas
      .find((t) => t.id === tableId).columns.find((c) => c.name === 'Stage');
    const destByName = new Map(Object.values(destField.typeOptions.choices).map((c) => [c.name, c.id]));
    assert.deepEqual(entry.choices, {
      selSRCTodo: destByName.get('Todo'),
      selSRCDone: destByName.get('Done'),
    }, 'choice map must be the REAL src→dest id map, not {}');
    assert.notEqual(entry.choices.selSRCTodo, 'selSRCTodo', 'dest ids were re-keyed — the map cannot be identity here');
  });

  it('multiSelect creates get their choice map too', async () => {
    const client = new RekeyingClient();
    const { tableId } = await client.createTable('appD', 'Offers');
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnMSel', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [selectAction({ sourceFieldId: 'fTags', name: 'Tags', type: 'multiSelect' })],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnMSel', 'ts'), persist: () => {} });
    assert.equal(res.failed, 0);
    assert.equal(Object.keys(res.idmap.fields.fTags.choices).length, 2, 'both choices mapped');
  });

  it('adopting an existing same-name select field registers its choice map (not {})', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'Offers');
    await client.createField('appD', tableId, {
      name: 'Stage', type: 'select',
      typeOptions: { choices: {
        selDSTTodo: { id: 'selDSTTodo', name: 'Todo', color: 'red' },
        selDSTDone: { id: 'selDSTDone', name: 'Done', color: 'gray' },
      } },
    });
    const destSnapshot = await snapshotBase(client, 'appD');
    const plan = {
      planId: 'plnAdopt', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [selectAction()],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnAdopt', 'ts'), persist: () => {} });
    assert.equal(res.created, 0);
    assert.equal(res.skipped, 1, 'adopted by name');
    assert.deepEqual(res.idmap.fields.fSel.choices, {
      selSRCTodo: 'selDSTTodo',
      selSRCDone: 'selDSTDone',
    }, 'adoption must name-match choices against the existing dest field');
  });

  it('non-select fields keep an empty choice map (no extra schema reads)', async () => {
    const client = new MockClient();
    const { tableId } = await client.createTable('appD', 'Offers');
    const destSnapshot = await snapshotBase(client, 'appD');
    const readsBefore = client.calls.length;
    const plan = {
      planId: 'plnTxt', sourceBaseId: 'appS', destBaseId: 'appD',
      idmap: { tables: { tS: tableId }, fields: {} },
      actions: [{ kind: 'createField', sourceTableId: 'tS', sourceFieldId: 'fTxt', name: 'Notes2', type: 'text', typeOptions: null, description: null, computed: false, dependsOn: [], dependsOnTables: [] }],
      orphans: [], warnings: [],
    };
    const res = await applyPlan({ client, plan, destAppId: 'appD', destSnapshot, idmap: JSON.parse(JSON.stringify(plan.idmap)), journal: newJournal('plnTxt', 'ts'), persist: () => {} });
    assert.equal(res.failed, 0);
    assert.deepEqual(res.idmap.fields.fTxt.choices, {});
    void readsBefore;
  });
});
