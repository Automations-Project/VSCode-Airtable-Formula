// Regression tests for the 2026-07-09 daemon 406 bug (Bug 2): a tools/call POST to
// /mcp used to fail with 406 "Client must accept both application/json and
// text/event-stream" for any client with an incomplete Accept header. The daemon now
// (a) upgrades lenient Accept headers (Postel shim) and (b) answers POSTs as plain
// JSON (enableJsonResponse) instead of an SSE stream.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { startDaemonServer } from '../src/daemon/server.js';

let tmpDir;
let server;

before(async () => {
  tmpDir = join(tmpdir(), 'test-airtable-mcp-accept-' + process.pid);
  mkdirSync(tmpDir, { recursive: true });
  server = await startDaemonServer({ port: 0, configDir: tmpDir, getTools: async () => [] });
});

after(async () => {
  if (server) { await server.stop().catch(() => {}); server = null; }
  rmSync(tmpDir, { recursive: true, force: true });
});

function postMcp(extraHeaders = {}) {
  return fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${server.bearerToken}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

describe('daemon /mcp Accept handling', () => {
  it('POST with Accept: application/json only is NOT rejected with 406', async () => {
    const res = await postMcp({ Accept: 'application/json' });
    assert.notStrictEqual(res.status, 406, 'lenient Accept header must not 406');
    assert.strictEqual(res.status, 200);
  });

  it('POST with no Accept header at all is NOT rejected with 406', async () => {
    const res = await postMcp();
    assert.notStrictEqual(res.status, 406);
    assert.strictEqual(res.status, 200);
  });

  it('spec-compliant POST gets a plain JSON body (enableJsonResponse), not an SSE stream', async () => {
    const res = await postMcp({ Accept: 'application/json, text/event-stream' });
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type') || '';
    assert.match(contentType, /application\/json/);
    const body = await res.json();
    assert.strictEqual(body.jsonrpc, '2.0');
    assert.strictEqual(body.id, 1);
    assert.ok(body.result, 'expected a JSON-RPC result envelope');
  });
});
