import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Note: DAEMON-01 attach-proxy behavior tested via mcp-server entry point.
// These stubs define the behavioral contract for AIRTABLE_NO_DAEMON env var handling.
// RED state — these tests fail (assertion errors) until index.mjs attach proxy is
// implemented in 05-05-PLAN.md.

describe('AIRTABLE_NO_DAEMON', () => {
  it('env var is checked before lockfile read', () => {
    assert.ok(false, 'NOT YET IMPLEMENTED — implement in 05-05-PLAN.md (index.js attach proxy)');
  });

  it('when set, stdio MCP server runs in-process without daemon', () => {
    assert.ok(false, 'NOT YET IMPLEMENTED — implement in 05-05-PLAN.md (index.js attach proxy)');
  });
});
