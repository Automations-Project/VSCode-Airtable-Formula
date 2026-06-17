/**
 * test-attachments-fastpath.test.js
 *
 * Unit tests for the server-side cross-base attachment fast-path in applyAttachments.
 * Covers:
 *   1. Happy path — createDataTransferPolicy + pasteAttachmentsCrossBase called correctly.
 *   2. Unmapped record exclusion — src records without an idmap.records entry are excluded.
 *   3. Fallback path — when pasteAttachmentsCrossBase returns skippedAttachments, the
 *      per-attachment download+upload path is invoked for those items.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyAttachments } from '../../src/sync/records.js';
import { newJournal } from '../../src/sync/journal.js';
import { createLimiter } from '../../src/sync/ratelimit.js';

function makeLimiter() {
  return createLimiter({ rps: 1000, sleep: async () => {} });
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal test harness. Returns mutable `calls` for assertions and the
 * core objects (client, idmap, srcSnapshot, destSnapshot, result, fetchBytes).
 *
 * @param {object} opts
 * @param {object[]} [opts.skippedAttachments=[]] - returned by pasteAttachmentsCrossBase
 * @param {boolean}  [opts.fastPathThrows=false]  - make pasteAttachmentsCrossBase throw
 */
function makeFixtures({ skippedAttachments = [], fastPathThrows = false } = {}) {
  const calls = {
    createDataTransferPolicy: [],
    pasteAttachmentsCrossBase: [],
    uploadAttachment: [],
    fetchBytes: [],
  };

  const client = {
    createDataTransferPolicy: async (sourceAppId, tableId, attachmentIdsWithCellLocation) => {
      calls.createDataTransferPolicy.push({ sourceAppId, tableId, attachmentIdsWithCellLocation });
      return { version: 1, data: 'base64-policy-token' };
    },

    pasteAttachmentsCrossBase: async (destAppId, destTableId, opts) => {
      calls.pasteAttachmentsCrossBase.push({ destAppId, destTableId, opts });
      if (fastPathThrows) {
        // Use status=422 and a non-transient message so withRetry does not retry
        // (defaultIsTransient checks both err.status and err.message for "network"/"fetch"/etc.)
        const err = new Error('pasteCells failed — schema mismatch (422)');
        err.status = 422;
        throw err;
      }
      return {
        numUpdatedCells: 2,
        pastedRowIds: ['recD1', 'recD2'],
        pastedColumnIds: ['fldAttD'],
        skippedAttachments,
        createdRowIdsDuringPaste: [],
        createdForeignRowIdsDuringPaste: [],
      };
    },

    uploadAttachment: async (appId, rowId, columnId, payload) => {
      calls.uploadAttachment.push({ appId, rowId, columnId, payload });
      return { ok: true, attachmentId: 'uploaded-' + payload.filename };
    },
  };

  const fetchBytes = async (url) => {
    calls.fetchBytes.push(url);
    return { bytes: Buffer.from('fake-data'), contentType: 'image/png' };
  };

  // Two source records, both mapped
  const idmap = {
    tables: { tblSrc: 'tblDest' },
    fields: {
      fldAttSrc: { destFld: 'fldAttD' },
    },
    records: {
      recS1: 'recD1',
      recS2: 'recD2',
      // recS_unmapped intentionally absent
    },
    attachments: {},
  };

  const srcSnapshot = {
    baseId: 'appSrc',
    tables: [{
      id: 'tblSrc',
      name: 'Table A',
      fields: [
        { id: 'fldAttSrc', name: 'Attachments', type: 'multipleAttachments', typeOptions: {} },
      ],
      records: [
        {
          id: 'recS1',
          cellValuesByColumnId: {
            fldAttSrc: [
              { id: 'att1', url: 'https://src/att1.png', filename: 'att1.png', size: 100, type: 'image/png' },
            ],
          },
        },
        {
          id: 'recS2',
          cellValuesByColumnId: {
            fldAttSrc: [
              { id: 'att2', url: 'https://src/att2.png', filename: 'att2.png', size: 200, type: 'image/png' },
            ],
          },
        },
        {
          // This record is NOT in idmap.records → must be excluded entirely
          id: 'recS_unmapped',
          cellValuesByColumnId: {
            fldAttSrc: [
              { id: 'att99', url: 'https://src/att99.png', filename: 'att99.png', size: 999, type: 'image/png' },
            ],
          },
        },
      ],
    }],
  };

  const destSnapshot = {
    baseId: 'appDest',
    tables: [{
      id: 'tblDest',
      name: 'Table A',
      fields: [{ id: 'fldAttD', name: 'Attachments', type: 'multipleAttachments' }],
      views: [
        { id: 'viwCollab1', name: 'Grid view', type: 'grid' }, // non-personal
      ],
      records: [],
    }],
  };

  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    attachmentsUploaded: 0,
    warnings: [],
  };

  return { calls, client, fetchBytes, idmap, srcSnapshot, destSnapshot, result };
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe('applyAttachments — fast-path (server-side cross-base copy)', () => {
  it('happy path: createDataTransferPolicy called with correct src rowIds/colIds/attIds, pasteAttachmentsCrossBase called with correct payload, result.attachmentsUploaded incremented', async () => {
    const { calls, client, fetchBytes, idmap, srcSnapshot, destSnapshot, result } = makeFixtures();

    await applyAttachments({
      client,
      srcSnapshot,
      destSnapshot,
      idmap,
      limiter: makeLimiter(),
      journal: newJournal('fp-1', 't'),
      persist: () => {},
      result,
      fetchBytes,
    });

    // createDataTransferPolicy must be called once
    assert.equal(calls.createDataTransferPolicy.length, 1, 'createDataTransferPolicy called once');
    const policyCall = calls.createDataTransferPolicy[0];
    assert.equal(policyCall.sourceAppId, 'appSrc');
    assert.equal(policyCall.tableId, 'tblSrc');

    // attachmentIdsWithCellLocation must contain entries for both mapped records only
    const attLocs = policyCall.attachmentIdsWithCellLocation;
    assert.equal(attLocs.length, 2, 'two attachments (unmapped record excluded)');

    const attLocIds = attLocs.map((a) => a.attachmentId).sort();
    assert.deepEqual(attLocIds, ['att1', 'att2']);

    // rowIds in policy must be src rowIds (not dest)
    const rowIds = attLocs.map((a) => a.rowId).sort();
    assert.deepEqual(rowIds, ['recS1', 'recS2']);

    // columnIds must be src column ids
    const colIds = [...new Set(attLocs.map((a) => a.columnId))];
    assert.deepEqual(colIds, ['fldAttSrc']);

    // pasteAttachmentsCrossBase must be called once
    assert.equal(calls.pasteAttachmentsCrossBase.length, 1, 'pasteAttachmentsCrossBase called once');
    const pasteCall = calls.pasteAttachmentsCrossBase[0];
    assert.equal(pasteCall.destAppId, 'appDest');
    assert.equal(pasteCall.destTableId, 'tblDest');

    const pasteOpts = pasteCall.opts;
    assert.equal(pasteOpts.sourceAppId, 'appSrc', 'sourceApplicationId = srcAppId');
    assert.equal(pasteOpts.sourceTableId, 'tblSrc');
    assert.deepEqual(pasteOpts.targetColumnIds, ['fldAttD'], 'dest column ids');

    // targetRowIds must be dest row ids (recD1, recD2)
    const targetRowIds = [...pasteOpts.targetRowIds].sort();
    assert.deepEqual(targetRowIds, ['recD1', 'recD2']);

    // sourceRowIds must be src row ids
    const sourceRowIds = [...pasteOpts.sourceRowIds].sort();
    assert.deepEqual(sourceRowIds, ['recS1', 'recS2']);

    // signedDataTransferPolicy forwarded from createDataTransferPolicy return value
    assert.deepEqual(pasteOpts.signedDataTransferPolicy, { version: 1, data: 'base64-policy-token' });

    // sourceCellValues2dArray: 2 rows × 1 col, each cell is the source attachment array
    assert.equal(pasteOpts.sourceCellValues2dArray.length, 2, '2 rows in 2d array');
    assert.equal(pasteOpts.sourceCellValues2dArray[0].length, 1, '1 col per row');

    // result.attachmentsUploaded incremented (by pastedRowIds.length = 2)
    assert.equal(result.attachmentsUploaded, 2, 'attachmentsUploaded = pastedRowIds.length');

    // No fallback download calls (fast-path succeeded)
    assert.equal(calls.fetchBytes.length, 0, 'no fetchBytes calls on fast-path success');
    assert.equal(calls.uploadAttachment.length, 0, 'no uploadAttachment calls on fast-path success');

    // No warnings
    assert.equal(result.warnings.length, 0, 'no warnings on happy path');
  });

  it('unmapped record excluded: recS_unmapped absent from idmap.records is not in attachmentIdsWithCellLocation', async () => {
    const { calls, client, fetchBytes, idmap, srcSnapshot, destSnapshot, result } = makeFixtures();

    await applyAttachments({
      client,
      srcSnapshot,
      destSnapshot,
      idmap,
      limiter: makeLimiter(),
      journal: newJournal('fp-2', 't'),
      persist: () => {},
      result,
      fetchBytes,
    });

    const policyCall = calls.createDataTransferPolicy[0];
    const attLocs = policyCall.attachmentIdsWithCellLocation;

    // att99 belongs to recS_unmapped — must be absent
    const attIds = attLocs.map((a) => a.attachmentId);
    assert.ok(!attIds.includes('att99'), 'att99 (unmapped record) must not appear in policy call');

    // src row ids in policy must only be recS1 and recS2
    const rowIds = [...new Set(attLocs.map((a) => a.rowId))].sort();
    assert.deepEqual(rowIds, ['recS1', 'recS2'], 'only mapped src rowIds in policy call');

    // targetRowIds in pasteCells must only be mapped dest rows
    const pasteOpts = calls.pasteAttachmentsCrossBase[0].opts;
    const targetRowIds = [...pasteOpts.targetRowIds].sort();
    assert.deepEqual(targetRowIds, ['recD1', 'recD2'], 'only mapped dest rowIds in pasteCells');
  });

  it('fallback path: skippedAttachments triggers uploadAttachment + fetchBytes for the skipped item', async () => {
    // att1 is returned as skipped by pasteAttachmentsCrossBase
    const { calls, client, fetchBytes, idmap, srcSnapshot, destSnapshot, result } = makeFixtures({
      skippedAttachments: [{ attachmentId: 'att1', reason: 'expired' }],
    });

    await applyAttachments({
      client,
      srcSnapshot,
      destSnapshot,
      idmap,
      limiter: makeLimiter(),
      journal: newJournal('fp-3', 't'),
      persist: () => {},
      result,
      fetchBytes,
    });

    // Fast-path still ran (both calls)
    assert.equal(calls.createDataTransferPolicy.length, 1, 'createDataTransferPolicy still called');
    assert.equal(calls.pasteAttachmentsCrossBase.length, 1, 'pasteAttachmentsCrossBase still called');

    // Fallback: fetchBytes called for the skipped attachment URL
    assert.equal(calls.fetchBytes.length, 1, 'fetchBytes called once for skipped attachment');
    assert.ok(calls.fetchBytes[0].includes('att1.png'), 'fetchBytes URL matches skipped attachment');

    // uploadAttachment called for the fallback
    assert.equal(calls.uploadAttachment.length, 1, 'uploadAttachment called once for fallback');
    assert.equal(calls.uploadAttachment[0].appId, 'appDest');
    assert.equal(calls.uploadAttachment[0].rowId, 'recD1', 'fallback uploads to correct dest row');
    assert.equal(calls.uploadAttachment[0].columnId, 'fldAttD', 'fallback uploads to correct dest col');
    assert.equal(calls.uploadAttachment[0].payload.filename, 'att1.png');

    // ATTACHMENT_FALLBACK warning emitted
    const fallbackWarns = result.warnings.filter((w) => w.code === 'ATTACHMENT_FALLBACK');
    assert.equal(fallbackWarns.length, 1, 'one ATTACHMENT_FALLBACK warning for the skip');
    assert.ok(fallbackWarns[0].message.includes('1'), 'warning mentions skipped count');
  });

  it('fast-path error: all included attachments fall back to per-attachment upload', async () => {
    const { calls, client, fetchBytes, idmap, srcSnapshot, destSnapshot, result } = makeFixtures({
      fastPathThrows: true,
    });

    // Must not throw
    await applyAttachments({
      client,
      srcSnapshot,
      destSnapshot,
      idmap,
      limiter: makeLimiter(),
      journal: newJournal('fp-4', 't'),
      persist: () => {},
      result,
      fetchBytes,
    });

    // createDataTransferPolicy was called (fast-path started)
    assert.equal(calls.createDataTransferPolicy.length, 1);

    // pasteAttachmentsCrossBase threw → fallback for 2 records × 1 field = 2 attachments
    assert.equal(calls.fetchBytes.length, 2, 'fetchBytes called for both attachments in fallback');
    assert.equal(calls.uploadAttachment.length, 2, 'uploadAttachment called for both attachments');

    // ATTACHMENT_FALLBACK warning emitted
    const fallbackWarns = result.warnings.filter((w) => w.code === 'ATTACHMENT_FALLBACK');
    assert.ok(fallbackWarns.length >= 1, 'at least one ATTACHMENT_FALLBACK warning');
    assert.ok(fallbackWarns[0].message.includes('422'), 'warning includes error message');
  });

  it('table with no attachment fields is skipped entirely (no client calls)', async () => {
    const calls = {
      createDataTransferPolicy: [],
      pasteAttachmentsCrossBase: [],
    };
    const client = {
      createDataTransferPolicy: async (...args) => { calls.createDataTransferPolicy.push(args); return {}; },
      pasteAttachmentsCrossBase: async (...args) => { calls.pasteAttachmentsCrossBase.push(args); return { pastedRowIds: [] }; },
      uploadAttachment: async () => ({ ok: true }),
    };

    const idmap = {
      tables: { tblSrc: 'tblDest' },
      fields: {}, // no attachment field mapping
      records: { recS1: 'recD1' },
      attachments: {},
    };

    const srcSnapshot = {
      baseId: 'appSrc',
      tables: [{
        id: 'tblSrc',
        name: 'T',
        fields: [{ id: 'fldText', name: 'Name', type: 'text' }],
        records: [{ id: 'recS1', cellValuesByColumnId: { fldText: 'hello' } }],
      }],
    };

    const destSnapshot = {
      baseId: 'appDest',
      tables: [{ id: 'tblDest', fields: [], views: [{ id: 'viw1', name: 'Grid' }], records: [] }],
    };

    const result = { attachmentsUploaded: 0, warnings: [] };

    await applyAttachments({
      client, srcSnapshot, destSnapshot, idmap,
      limiter: makeLimiter(),
      journal: newJournal('fp-5', 't'),
      persist: () => {},
      result,
      fetchBytes: async () => ({ bytes: Buffer.from(''), contentType: '' }),
    });

    assert.equal(calls.createDataTransferPolicy.length, 0, 'no policy call when no attachment fields');
    assert.equal(calls.pasteAttachmentsCrossBase.length, 0, 'no paste call when no attachment fields');
    assert.equal(result.attachmentsUploaded, 0);
    assert.equal(result.warnings.length, 0);
  });
});
