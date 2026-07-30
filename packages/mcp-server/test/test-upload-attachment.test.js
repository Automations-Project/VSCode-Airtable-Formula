import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uploadAttachmentsByUrl } from '../src/attachments.js';

// ──────────────────────────────────────────────────────────────────────────────
// Fake client
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a fake client with addAttachmentByUrl that:
 *  - records every call in `calls`
 *  - returns values from `responses` keyed by call index, or a default success
 */
function fakeClient(responses = []) {
  const calls = [];
  const client = {
    calls,
    async addAttachmentByUrl(appId, rowId, columnId, { url, filename } = {}) {
      const callIdx = calls.length;
      calls.push({ appId, rowId, columnId, url, filename });
      const override = responses[callIdx];
      if (override !== undefined) return override;
      return { ok: true, attachmentId: 'attFAKE', url: 'https://fake.cdn/file' };
    },
  };
  return client;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('uploadAttachmentsByUrl — happy path', () => {
  it('2 updates both succeed: uploaded.length===2, failed.length===0', async () => {
    const client = fakeClient([
      { ok: true, attachmentId: 'att1', url: 'https://cdn/1.jpg' },
      { ok: true, attachmentId: 'att2', url: 'https://cdn/2.jpg' },
    ]);

    const result = await uploadAttachmentsByUrl(client, 'appABC', [
      { rowId: 'recA', columnId: 'fld1', url: 'https://example.com/a.jpg' },
      { rowId: 'recB', columnId: 'fld2', url: 'https://example.com/b.jpg', filename: 'override.png' },
    ]);

    assert.equal(result.uploaded.length, 2, 'expected 2 uploaded');
    assert.equal(result.failed.length, 0, 'expected 0 failed');

    // Verify addAttachmentByUrl was called with the right args
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[0].appId, 'appABC');
    assert.equal(client.calls[0].rowId, 'recA');
    assert.equal(client.calls[0].columnId, 'fld1');
    assert.equal(client.calls[0].url, 'https://example.com/a.jpg');
    assert.equal(client.calls[0].filename, undefined);

    assert.equal(client.calls[1].rowId, 'recB');
    assert.equal(client.calls[1].columnId, 'fld2');
    assert.equal(client.calls[1].url, 'https://example.com/b.jpg');
    assert.equal(client.calls[1].filename, 'override.png');

    // Verify uploaded entries have correct shape
    assert.equal(result.uploaded[0].rowId, 'recA');
    assert.equal(result.uploaded[0].columnId, 'fld1');
    assert.equal(result.uploaded[0].attachmentId, 'att1');
    assert.equal(result.uploaded[0].url, 'https://cdn/1.jpg');
    assert.equal(result.uploaded[1].attachmentId, 'att2');
  });
});

describe('uploadAttachmentsByUrl — per-update isolation', () => {
  it('1st fails, 2nd succeeds: both attempted, failed.length===1, uploaded.length===1', async () => {
    const client = fakeClient([
      { ok: false, error: 'boom' },
      { ok: true, attachmentId: 'attX', url: 'https://cdn/ok.jpg' },
    ]);

    const result = await uploadAttachmentsByUrl(client, 'appABC', [
      { rowId: 'rec1', columnId: 'fld1', url: 'https://example.com/a.jpg' },
      { rowId: 'rec2', columnId: 'fld2', url: 'https://example.com/b.jpg' },
    ]);

    assert.equal(result.failed.length, 1, 'expected 1 failure');
    assert.equal(result.uploaded.length, 1, 'expected 1 success');
    // Both were attempted
    assert.equal(client.calls.length, 2, 'addAttachmentByUrl must have been called twice');

    assert.equal(result.failed[0].rowId, 'rec1');
    assert.equal(result.failed[0].columnId, 'fld1');
    assert.match(result.failed[0].error, /boom/);

    assert.equal(result.uploaded[0].rowId, 'rec2');
    assert.equal(result.uploaded[0].attachmentId, 'attX');
  });
});

describe('uploadAttachmentsByUrl — validation', () => {
  it('update missing url goes to failed without calling addAttachmentByUrl', async () => {
    const client = fakeClient();

    const result = await uploadAttachmentsByUrl(client, 'appABC', [
      { rowId: 'rec1', columnId: 'fld1' /* url missing */ },
    ]);

    assert.equal(result.failed.length, 1, 'expected 1 failure');
    assert.equal(result.uploaded.length, 0);
    assert.equal(client.calls.length, 0, 'addAttachmentByUrl must NOT have been called');
    assert.ok(result.failed[0].error, 'error message must be set');
  });

  it('update missing rowId goes to failed without calling addAttachmentByUrl', async () => {
    const client = fakeClient();

    const result = await uploadAttachmentsByUrl(client, 'appABC', [
      { columnId: 'fld1', url: 'https://example.com/x.jpg' /* rowId missing */ },
    ]);

    assert.equal(result.failed.length, 1);
    assert.equal(client.calls.length, 0, 'addAttachmentByUrl must NOT have been called');
    assert.ok(result.failed[0].error);
  });

  it('update missing columnId goes to failed without calling addAttachmentByUrl', async () => {
    const client = fakeClient();

    const result = await uploadAttachmentsByUrl(client, 'appABC', [
      { rowId: 'rec1', url: 'https://example.com/x.jpg' /* columnId missing */ },
    ]);

    assert.equal(result.failed.length, 1);
    assert.equal(client.calls.length, 0, 'addAttachmentByUrl must NOT have been called');
    assert.ok(result.failed[0].error);
  });

  it('valid updates after invalid ones still succeed (mixed batch)', async () => {
    const client = fakeClient([
      { ok: true, attachmentId: 'attGOOD', url: 'https://cdn/good.jpg' },
    ]);

    const result = await uploadAttachmentsByUrl(client, 'appABC', [
      { rowId: 'rec1' /* missing url and columnId */ },
      { rowId: 'rec2', columnId: 'fld2', url: 'https://example.com/good.jpg' },
    ]);

    assert.equal(result.failed.length, 1);
    assert.equal(result.uploaded.length, 1);
    assert.equal(client.calls.length, 1, 'only the valid update should call addAttachmentByUrl');
    assert.equal(result.uploaded[0].attachmentId, 'attGOOD');
  });
});
