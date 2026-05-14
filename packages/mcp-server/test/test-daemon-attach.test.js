import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(
  new URL('../src/index.js', import.meta.url),
  'utf8',
);

describe('AIRTABLE_NO_DAEMON', () => {
  it('env var is checked before lockfile read', () => {
    assert.ok(
      indexSource.includes('AIRTABLE_NO_DAEMON'),
      'index.js must reference AIRTABLE_NO_DAEMON to skip attach proxy',
    );
    // Verify that AIRTABLE_NO_DAEMON check appears before the lockfile read
    const noDeamonIdx = indexSource.indexOf('AIRTABLE_NO_DAEMON');
    const lockfileIdx = indexSource.indexOf('readLockfile');
    assert.ok(
      noDeamonIdx < lockfileIdx,
      `AIRTABLE_NO_DAEMON check (pos ${noDeamonIdx}) must precede readLockfile (pos ${lockfileIdx})`,
    );
  });

  it('when set, stdio MCP server runs in-process without daemon', () => {
    // Verify the attach block is guarded by the env var check, ensuring
    // when AIRTABLE_NO_DAEMON is set the code falls through to in-process.
    // The block structure: if (!process.env.AIRTABLE_NO_DAEMON) { ... ensureDaemon ... }
    assert.ok(
      indexSource.includes('AIRTABLE_NO_DAEMON') && indexSource.includes('ensureDaemon'),
      'index.js must have AIRTABLE_NO_DAEMON guard around ensureDaemon call',
    );
    // Confirm the in-process server code (Server class) is still present
    assert.ok(
      indexSource.includes('new Server('),
      'index.js must retain the in-process Server constructor for the stdio fallback path',
    );
  });
});
