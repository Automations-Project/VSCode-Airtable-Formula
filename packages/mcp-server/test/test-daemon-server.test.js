import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDaemonServer } from '../src/daemon/server.js';

// Test scaffolds for DAEMON-05: bearer auth middleware, health endpoint, SSE endpoint
// RED state — import fails with ERR_MODULE_NOT_FOUND until packages/mcp-server/src/daemon/server.js is created in Wave 2.

let tmpDir;

before(() => {
  // No tmpdir needed for server tests — server binds a random port
});

after(() => {
  // Nothing to clean up at suite level
});

describe('startDaemonServer', () => {
  it('startDaemonServer is a function', () => {
    assert.strictEqual(typeof startDaemonServer, 'function');
  });

  it('binds on a port and returns object with .bearerToken getter and .stop()', async () => {
    assert.ok(false, 'NOT YET IMPLEMENTED — will pass after Wave 2 implementation');
  });
});

describe('GET /daemon/health', () => {
  it('returns 200 with uptime JSON when correct bearer token provided', async () => {
    assert.ok(false, 'NOT YET IMPLEMENTED — will pass after Wave 2 implementation');
  });

  it('returns 401 when Authorization header is missing', async () => {
    assert.ok(false, 'NOT YET IMPLEMENTED — will pass after Wave 2 implementation');
  });
});

describe('GET /daemon/events', () => {
  it('returns 401 when bearer token is wrong', async () => {
    assert.ok(false, 'NOT YET IMPLEMENTED — will pass after Wave 2 implementation');
  });
});
