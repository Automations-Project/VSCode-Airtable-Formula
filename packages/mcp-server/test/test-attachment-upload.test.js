import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AirtableClient } from '../src/client.js';

function mockAuthForUpload() {
  const calls = [];
  return {
    calls,
    getSecretSocketId: () => 'socTEST',
    postForm(url, params) {
      calls.push({ url, params });
      if (url.endsWith('/createMultipartUpload')) return { ok: true, status: 200, json: async () => ({ data: { uploadId: 'up1', objectKey: 'ok1', bucketName: 'b' } }), text: async () => '{}' };
      if (url.endsWith('/getUrlMultipartUpload')) return { ok: true, status: 200, json: async () => ({ data: { presignedUrl: 'https://s3.example/put?x=1' } }), text: async () => '{}' };
      if (url.endsWith('/completeMultipartUpload')) return { ok: true, status: 200, json: async () => ({ data: { url: 'https://dl.airtable.com/f', signedUrl: 'https://v5.airtableusercontent.com/s', propsToAddToAttachmentObj: { signedMetadata: { version: 1, data: 'b64.sig' }, size: 5, type: 'text/plain', url: 'https://dl.airtable.com/f' } } }), text: async () => '{}' };
      if (url.includes('/updateArrayTypeCellByAddingItem')) return { ok: true, status: 200, json: async () => ({ data: null }), text: async () => '{}' };
      return { ok: false, status: 500, json: async () => ({}), text: async () => 'unexpected' };
    },
  };
}

describe('AirtableClient.uploadAttachment', () => {
  it('runs the 5-step flow and attaches the file', async () => {
    const auth = mockAuthForUpload();
    const client = new AirtableClient(auth);
    const putCalls = [];
    client._putBytes = async (url, bytes, checksum) => { putCalls.push({ url, checksum }); return { ok: true, etag: '"etag1"' }; };

    const result = await client.uploadAttachment('appT', 'recT', 'fldT', {
      bytes: Buffer.from('hello'), filename: 'hi.txt', contentType: 'text/plain',
    });

    assert.equal(result.ok, true);
    assert.ok(result.attachmentId.startsWith('att'));
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].url, 'https://s3.example/put?x=1');
    const expectedChecksum = createHash('sha256').update(Buffer.from('hello')).digest('base64');
    assert.equal(putCalls[0].checksum, expectedChecksum);
    const seq = auth.calls.map(c => c.url.split('/').pop());
    assert.deepEqual(seq, ['createMultipartUpload', 'getUrlMultipartUpload', 'completeMultipartUpload', 'updateArrayTypeCellByAddingItem']);
    const completePayload = JSON.parse(auth.calls[2].params.stringifiedObjectParams);
    assert.equal(completePayload.multipartUploadComplete.parts[0].etag, '"etag1"');
  });

  it('returns a soft failure (no throw) when a step errors', async () => {
    const auth = mockAuthForUpload();
    const orig = auth.postForm;
    auth.postForm = (url, params) => url.endsWith('/createMultipartUpload')
      ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }
      : orig(url, params);
    const client = new AirtableClient(auth);
    client._putBytes = async () => ({ ok: true, etag: '"e"' });
    const result = await client.uploadAttachment('appT', 'recT', 'fldT', { bytes: Buffer.from('x'), filename: 'x', contentType: 'text/plain' });
    assert.equal(result.ok, false);
    assert.match(result.error, /createMultipartUpload/);
  });
});

describe('AirtableClient.uploadAttachment guards', () => {
  it('soft-fails when getUrlMultipartUpload returns no presignedUrl', async () => {
    const auth = mockAuthForUpload();
    const orig = auth.postForm;
    auth.postForm = (url, params) => url.endsWith('/getUrlMultipartUpload')
      ? { ok: true, status: 200, json: async () => ({ data: {} }), text: async () => '{}' }
      : orig(url, params);
    const client = new AirtableClient(auth);
    client._putBytes = async () => ({ ok: true, etag: '"e"' });
    const result = await client.uploadAttachment('appT', 'recT', 'fldT', { bytes: Buffer.from('x'), filename: 'x', contentType: 'text/plain' });
    assert.equal(result.ok, false);
    assert.match(result.error, /presignedUrl/);
  });

  it('soft-fails when the final attach call errors', async () => {
    const auth = mockAuthForUpload();
    const orig = auth.postForm;
    auth.postForm = (url, params) => url.includes('/updateArrayTypeCellByAddingItem')
      ? { ok: false, status: 422, json: async () => ({}), text: async () => 'bad attach' }
      : orig(url, params);
    const client = new AirtableClient(auth);
    client._putBytes = async () => ({ ok: true, etag: '"e"' });
    const result = await client.uploadAttachment('appT', 'recT', 'fldT', { bytes: Buffer.from('x'), filename: 'x', contentType: 'text/plain' });
    assert.equal(result.ok, false);
    assert.match(result.error, /attach failed/);
  });
});
