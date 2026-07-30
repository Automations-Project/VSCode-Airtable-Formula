// Task 4: a computed (lookup/rollup/formula) updateField that runs in the SAME apply pass as
// the link field it depends on gets rejected by Airtable with a 422 naming the link dependency
// explicitly ("requires a link field" / "link field was changed by a collaborator") until the
// link change settles. apply.js must defer (not hard-fail) that specific rejection so the
// existing retry-until-stable loop in applyPlan re-attempts it later in the same run.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockClient } from './helpers/mock-client.js';
import { applyPlan } from '../../src/sync/apply.js';
import { newJournal, isDone } from '../../src/sync/journal.js';
import { snapshotBase } from '../../src/sync/snapshot.js';

const LINK_DEP_MSG = 'This column requires a link field. The link field was changed by a collaborator.';

async function setup() {
  const client = new MockClient();
  const { tableId } = await client.createTable('appD', 'T');
  const price = await client.createField('appD', tableId, { name: 'Price', type: 'number' });
  const total = await client.createField('appD', tableId, { name: 'Total', type: 'formula', typeOptions: { formulaTextParsed: '{column_value_OLD}' } });
  const destSnapshot = await snapshotBase(client, 'appD');
  const plan = {
    planId: 'plnLD', sourceBaseId: 'appS', destBaseId: 'appD',
    idmap: { tables: {}, fields: { [price.columnId]: { destFld: price.columnId, choices: {} } } },
    actions: [{
      kind: 'updateField', sourceFieldId: total.columnId, destFld: total.columnId,
      changes: {
        typeOptions: {
          formulaTextParsed: `{column_value_${price.columnId}}*2`,
          dependencies: { referencedColumnIdsForValue: [price.columnId] },
          resultType: 'number', resultIsArray: false,
        },
      },
    }],
    orphans: [], warnings: [],
  };
  return { client, plan, destSnapshot, totalId: total.columnId, priceId: price.columnId };
}

describe('apply: updateField computed — link-dependency 422 deferral', () => {
  it('defers on the link-dependency 422, then succeeds once the link has settled (retry-until-stable)', async () => {
    const { client, plan, destSnapshot, totalId, priceId } = await setup();
    let calls = 0;
    const orig = client.updateFieldConfig.bind(client);
    client.updateFieldConfig = async (appId, columnId, cfg) => {
      if (columnId === totalId) {
        calls++;
        if (calls === 1) throw new Error(LINK_DEP_MSG);
      }
      return orig(appId, columnId, cfg);
    };
    const journal = newJournal(plan.planId, 'ts');
    const res = await applyPlan({
      client, plan, destAppId: 'appD', destSnapshot,
      idmap: JSON.parse(JSON.stringify(plan.idmap)),
      journal, persist: () => {},
    });
    assert.equal(res.failed, 0, 'must NOT be counted as a hard failure');
    assert.equal(calls, 2, 'the deferred-retry loop re-attempted updateFieldConfig for the field');
    assert.equal(res.updated, 1, 'the field is updated by run end');
    assert.ok(!res.warnings.some((w) => w.code === 'ACTION_FAILED'));
    const f = client._field(totalId);
    assert.equal(f.typeOptions.formulaText, `{${priceId}}*2`);
    assert.ok(isDone(journal, 0), 'resolved this run — journaled done');
  });

  it('never resolving is bounded (no hang), reported as skipped (not failed), warning surfaced, NOT journaled done', async () => {
    const { client, plan, destSnapshot } = await setup();
    client.updateFieldConfig = async () => { throw new Error(LINK_DEP_MSG); };
    const journal = newJournal(plan.planId, 'ts');
    const res = await applyPlan({
      client, plan, destAppId: 'appD', destSnapshot,
      idmap: JSON.parse(JSON.stringify(plan.idmap)),
      journal, persist: () => {},
    });
    assert.equal(res.failed, 0, 'never a hard failure, even when it never resolves this run');
    assert.ok(res.skipped >= 1, 'counted as skipped, not failed');
    assert.ok(res.warnings.some((w) => w.code === 'LINK_DEPENDENCY_DEFERRED'), 'held-back warning is surfaced at run end');
    assert.ok(!res.warnings.some((w) => w.code === 'ACTION_FAILED'));
    assert.ok(!isDone(journal, 0), 'not journaled done — retryable on a future run');
  });

  it('a different 422 (non link-dependency) still hard-fails as ACTION_FAILED', async () => {
    const { client, plan, destSnapshot } = await setup();
    client.updateFieldConfig = async () => { throw new Error('422: invalid formula — unknown function FOO()'); };
    const journal = newJournal(plan.planId, 'ts');
    const res = await applyPlan({
      client, plan, destAppId: 'appD', destSnapshot,
      idmap: JSON.parse(JSON.stringify(plan.idmap)),
      journal, persist: () => {},
    });
    assert.equal(res.failed, 1, 'unrelated errors keep the existing hard-fail path');
    assert.ok(res.warnings.some((w) => w.code === 'ACTION_FAILED'));
    assert.ok(!res.warnings.some((w) => w.code === 'LINK_DEPENDENCY_DEFERRED'), 'deferral must not swallow unrelated errors');
    assert.ok(!isDone(journal, 0));
  });
});
