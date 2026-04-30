// Tests for the 2.4.0 feature additions (user report 2026-04-30 §1.3, §1.4, §3.1):
//   View sections, bulk column ops, view presentation, calendar, form metadata.
// All tests use the mock-auth pattern from test-client.test.js — they verify
// the URL and stringified payload the client *would have sent*.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableClient } from '../src/client.js';

const SCHEMA_WITH_SECTIONS = {
  data: {
    tableSchemas: [
      {
        id: 'tblAAA',
        name: 'Offers',
        columns: [{ id: 'fldA', name: 'Name', type: 'text', typeOptions: {} }],
        views: [{ id: 'viwGrid', name: 'Grid', type: 'grid' }],
        viewSections: {
          vscRocket: { id: 'vscRocket', name: '🚀 Posting workflow', viewOrder: ['viwInsideA'], pinnedForUserId: null, createdByUserId: 'usr1' },
          vscTrash:  { id: 'vscTrash',  name: '🗑️ Sold workflow',     viewOrder: [],                pinnedForUserId: null, createdByUserId: 'usr1' },
        },
        viewOrder: ['viwGrid', 'vscRocket', 'vscTrash'],
      },
    ],
  },
};

const SCHEMA_WITH_VIEW = {
  data: {
    tableSchemas: [
      {
        id: 'tblBBB',
        name: 'T',
        columns: [
          { id: 'fldA', name: 'A', type: 'text', typeOptions: {} },
          { id: 'fldB', name: 'B', type: 'text', typeOptions: {} },
          { id: 'fldC', name: 'C', type: 'text', typeOptions: {} },
        ],
        views: [{ id: 'viwT', name: 'Grid', type: 'grid' }],
      },
    ],
  },
};

const VIEW_DATA_FOR_VIEW = {
  data: {
    viewDatas: [
      {
        id: 'viwT',
        type: 'grid',
        columnOrder: [
          { columnId: 'fldA', visibility: true },
          { columnId: 'fldB', visibility: true },
          { columnId: 'fldC', visibility: true },
        ],
      },
    ],
  },
};

function createMockAuth(schema, { postForm } = {}) {
  const calls = [];
  return {
    calls,
    getSecretSocketId: () => 'socTEST',
    get(url) {
      calls.push({ method: 'GET', url });
      if (url.includes('readData')) {
        return { ok: true, status: 200, json: async () => VIEW_DATA_FOR_VIEW, text: async () => JSON.stringify(VIEW_DATA_FOR_VIEW) };
      }
      return { ok: true, status: 200, json: async () => schema, text: async () => JSON.stringify(schema) };
    },
    postForm(url, params) {
      calls.push({ method: 'POST', url, params });
      if (postForm) return postForm(url, params);
      return { ok: true, status: 200, json: async () => ({ msg: 'SUCCESS', data: null }), text: async () => '{}' };
    },
    postJSON: () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
}

function findPost(auth, urlSubstr) {
  const post = auth.calls.find(c => c.method === 'POST' && c.url.includes(urlSubstr));
  assert.ok(post, `expected POST containing "${urlSubstr}"`);
  return JSON.parse(post.params.stringifiedObjectParams);
}

describe('listViewSections (§1.3)', () => {
  it('returns sections with view counts and the table-level mixed viewOrder', async () => {
    const auth = createMockAuth(SCHEMA_WITH_SECTIONS);
    const client = new AirtableClient(auth);
    const result = await client.listViewSections('appXXX', 'tblAAA');
    assert.equal(result.sections.length, 2);
    const rocket = result.sections.find(s => s.id === 'vscRocket');
    assert.equal(rocket.name, '🚀 Posting workflow');
    assert.equal(rocket.viewCount, 1);
    assert.deepEqual(rocket.viewOrder, ['viwInsideA']);
    assert.equal(rocket.partial, false);
    assert.deepEqual(result.tableViewOrder, ['viwGrid', 'vscRocket', 'vscTrash']);
    assert.equal(result.introspectionPartial, undefined);
  });

  it('reads from `viewSectionsById` (the real Airtable response key, 2.4.3)', async () => {
    const realShapeSchema = {
      data: {
        tableSchemas: [
          {
            id: 'tblAAA',
            name: 'Offers',
            columns: [{ id: 'fldA', name: 'A', type: 'text', typeOptions: {} }],
            views: [{ id: 'viwGrid', name: 'Grid', type: 'grid' }],
            viewOrder: ['viwGrid', 'vscRocket'],
            // Real Airtable shape — captured 2026-05-01
            viewSectionsById: {
              vscRocket: { id: 'vscRocket', name: '🚀 Posting', createdByUserId: 'usr1', pinnedForUserId: null, viewOrder: ['viwInsideA'] },
            },
          },
        ],
      },
    };
    const auth = createMockAuth(realShapeSchema);
    const client = new AirtableClient(auth);
    const result = await client.listViewSections('appXXX', 'tblAAA');
    assert.equal(result.sections.length, 1);
    assert.equal(result.sections[0].id, 'vscRocket');
    assert.equal(result.sections[0].name, '🚀 Posting');
    assert.deepEqual(result.sections[0].viewOrder, ['viwInsideA']);
    assert.equal(result.sections[0].partial, false);
    assert.equal(result.introspectionPartial, undefined);
  });

  it('falls back to surfacing section IDs from tableViewOrder when viewSections is missing (Bug 2 hotfix 2026-05-01)', async () => {
    // Simulate the user follow-up scenario: table.viewSections empty, but
    // table.viewOrder still contains vsc-prefixed IDs.
    const schemaWithMissingSections = {
      data: {
        tableSchemas: [
          {
            id: 'tblAAA',
            name: 'Offers',
            columns: [{ id: 'fldA', name: 'A', type: 'text', typeOptions: {} }],
            views: [{ id: 'viwGrid', name: 'Grid', type: 'grid' }],
            viewOrder: ['vscPreExisting1', 'vscPreExisting2', 'viwGrid', 'vscNewlyCreated'],
            // viewSections deliberately omitted to simulate the schema gap
          },
        ],
      },
    };
    const auth = createMockAuth(schemaWithMissingSections);
    const client = new AirtableClient(auth);
    const result = await client.listViewSections('appXXX', 'tblAAA');

    // Should still surface the 3 section IDs as partial entries
    assert.equal(result.sections.length, 3);
    assert.deepEqual(result.sections.map(s => s.id), ['vscPreExisting1', 'vscPreExisting2', 'vscNewlyCreated']);
    assert.equal(result.sections[0].name, null);
    assert.equal(result.sections[0].viewOrder, null);
    assert.equal(result.sections[0].partial, true);
    assert.equal(result.introspectionPartial, true);
    assert.match(result.introspectionNote, /Section names and viewOrder are not currently readable/);
  });
});

describe('createViewSection (§1.3)', () => {
  it('generates a vsc-prefixed ID and posts {tableId, name}', async () => {
    const auth = createMockAuth(SCHEMA_WITH_SECTIONS);
    const client = new AirtableClient(auth);
    const result = await client.createViewSection('appXXX', 'tblAAA', '🚀 Test');
    assert.match(result.id, /^vsc/);
    const sent = findPost(auth, '/viewSection/');
    assert.equal(sent.tableId, 'tblAAA');
    assert.equal(sent.name, '🚀 Test');
  });

  it('rejects non-vsc sectionIds in rename/delete', async () => {
    const auth = createMockAuth(SCHEMA_WITH_SECTIONS);
    const client = new AirtableClient(auth);
    await assert.rejects(() => client.renameViewSection('appXXX', 'viwBADID', 'x'), /vsc/);
    await assert.rejects(() => client.deleteViewSection('appXXX', 'viwBADID'),     /vsc/);
  });
});

describe('moveViewOrViewSection (§1.3)', () => {
  it('omits targetViewSectionId when moving to ungrouped', async () => {
    const auth = createMockAuth(SCHEMA_WITH_SECTIONS);
    const client = new AirtableClient(auth);
    await client.moveViewOrViewSection('appXXX', 'tblAAA', 'viwInsideA', 2);
    const sent = findPost(auth, '/moveViewOrViewSection');
    assert.equal(sent.viewIdOrViewSectionId, 'viwInsideA');
    assert.equal(sent.targetIndex, 2);
    assert.equal(sent.targetViewSectionId, undefined);
  });

  it('includes targetViewSectionId when moving into a section', async () => {
    const auth = createMockAuth(SCHEMA_WITH_SECTIONS);
    const client = new AirtableClient(auth);
    await client.moveViewOrViewSection('appXXX', 'tblAAA', 'viwInsideA', 0, 'vscRocket');
    const sent = findPost(auth, '/moveViewOrViewSection');
    assert.equal(sent.targetViewSectionId, 'vscRocket');
  });
});

describe('setViewColumns one-shot (§1.4 — Bug 1 hotfix 2026-05-01)', () => {
  it('hides all → shows requested → moves the whole list in ONE batched call starting at index 1', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await client.setViewColumns('appXXX', 'viwT', { visibleColumnIds: ['fldB', 'fldA'], frozenColumnCount: 1 });

    // 1. showOrHideAllColumns(false)
    const hideAll = findPost(auth, '/showOrHideAllColumns');
    assert.equal(hideAll.visibility, false);

    // 2. showOrHideColumns(['fldB','fldA'], true)
    const show = findPost(auth, '/showOrHideColumns');
    assert.deepEqual(show.columnIds, ['fldB', 'fldA']);
    assert.equal(show.visibility, true);

    // 3. ONE batched moveVisibleColumns call — entire list, target index 1
    //    (after the pinned primary column). Per-id loops 422'd in v2.4.0.
    const moves = auth.calls.filter(c => c.url.includes('/moveVisibleColumns'));
    assert.equal(moves.length, 1);
    const movePayload = JSON.parse(moves[0].params.stringifiedObjectParams);
    assert.deepEqual(movePayload.columnIds, ['fldB', 'fldA']);
    assert.equal(movePayload.targetVisibleIndex, 1);

    // 4. updateFrozenColumnCount(1)
    const freeze = findPost(auth, '/updateFrozenColumnCount');
    assert.equal(freeze.frozenColumnCount, 1);
  });

  it('skips frozen-column update when not provided', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await client.setViewColumns('appXXX', 'viwT', { visibleColumnIds: ['fldA'] });
    const freezes = auth.calls.filter(c => c.url.includes('/updateFrozenColumnCount'));
    assert.equal(freezes.length, 0);
  });

  it('rejects empty visibleColumnIds', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await assert.rejects(() => client.setViewColumns('appXXX', 'viwT', { visibleColumnIds: [] }), /non-empty/);
  });
});

describe('view presentation (§3.1 — Kanban + Gallery)', () => {
  it('setViewCover sends both column-id and fit-type when provided', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await client.setViewCover('appXXX', 'viwT', { coverColumnId: 'fldA', coverFitType: 'crop' });
    const colId = findPost(auth, '/updateCoverColumnId');
    const fit   = findPost(auth, '/updateCoverFitType');
    assert.equal(colId.coverColumnId, 'fldA');
    assert.equal(fit.coverFitType, 'crop');
  });

  it('setViewCover with coverColumnId: null removes the cover', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await client.setViewCover('appXXX', 'viwT', { coverColumnId: null });
    const colId = findPost(auth, '/updateCoverColumnId');
    assert.equal(colId.coverColumnId, null);
  });

  it('setViewCover rejects invalid coverFitType', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await assert.rejects(() => client.setViewCover('appXXX', 'viwT', { coverFitType: 'stretch' }), /fit.*crop/);
  });

  it('setViewColorConfig forwards the config object', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await client.setViewColorConfig('appXXX', 'viwT', { type: 'selectColumn', selectColumnId: 'fldA', colorDefinitions: null });
    const sent = findPost(auth, '/updateColorConfig');
    assert.equal(sent.colorConfig.type, 'selectColumn');
    assert.equal(sent.colorConfig.selectColumnId, 'fldA');
  });
});

describe('calendar (§3.1)', () => {
  it('forwards single-date and range entries together', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await client.setCalendarDateColumns('appXXX', 'viwT', [
      { startColumnId: 'fldA', endColumnId: 'fldB' },
      { startColumnId: 'fldC' },
    ]);
    const sent = findPost(auth, '/updateCalendarDateColumnRanges');
    assert.equal(sent.dateColumnRanges.length, 2);
    assert.equal(sent.dateColumnRanges[0].endColumnId, 'fldB');
    assert.equal(sent.dateColumnRanges[1].endColumnId, undefined);
  });

  it('rejects empty array', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await assert.rejects(() => client.setCalendarDateColumns('appXXX', 'viwT', []), /non-empty/);
  });
});

describe('form metadata (§3.1)', () => {
  it('fans out to per-property endpoints for each set field', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await client.setFormMetadata('appXXX', 'viwT', {
      description: 'intro',
      redirectUrl: 'https://example.com',
      shouldAttributeResponses: true,
    });
    const desc = findPost(auth, '/updateFormDescription');
    const url  = findPost(auth, '/updateFormRedirectUrl');
    const attr = findPost(auth, '/updateFormShouldAttributeResponses');
    assert.equal(desc.description, 'intro');
    assert.equal(url.redirectUrl, 'https://example.com');
    assert.equal(attr.shouldAttributeResponses, true);
  });

  it('does NOT send unrelated endpoints', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await client.setFormMetadata('appXXX', 'viwT', { description: 'only this' });
    const calls = auth.calls.filter(c => c.method === 'POST' && c.url.includes('/updateForm'));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/updateFormDescription'));
  });

  it('rejects empty props', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await assert.rejects(() => client.setFormMetadata('appXXX', 'viwT', {}), /at least one/);
  });

  it('setFormSubmissionNotification rejects non-usr userId', async () => {
    const auth = createMockAuth(SCHEMA_WITH_VIEW);
    const client = new AirtableClient(auth);
    await assert.rejects(() => client.setFormSubmissionNotification('appXXX', 'viwT', 'badId', true), /usr/);
  });
});
