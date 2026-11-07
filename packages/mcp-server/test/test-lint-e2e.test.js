// node --test
// End to end: a real stdio MCP session against the real server entry, with no
// credentials and no browser. index.js runs main() at import, so it can only be
// exercised as a child process.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');
const CONNECT_TIMEOUT_MS = 60_000;

function parse(result) {
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

// The developer's environment minus every AIRTABLE_* key, so a cookie, auth mode,
// home or daemon setting exported in the shell cannot reach the child. Compared
// upper-cased because Windows environment names are case-insensitive.
function credentialFreeEnv(home) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('AIRTABLE_')) delete env[key];
  }
  env.AIRTABLE_NO_DAEMON = '1';
  env.AIRTABLE_USER_MCP_HOME = home;
  env.AIRTABLE_AUTH_MODE = 'byo';
  return env;
}

describe('lint_airtable_code through a live MCP session', () => {
  let home;
  let client;
  let transport;
  let stderr = '';

  before(async () => {
    home = mkdtempSync(path.join(tmpdir(), 'airtable-mcp-lint-e2e-'));
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [INDEX],
      env: credentialFreeEnv(home),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (c) => { stderr += c; });
    client = new Client({ name: 'lint-e2e', version: '0.0.0' });

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`MCP handshake did not complete in ${CONNECT_TIMEOUT_MS}ms. Server stderr:\n${stderr}`)),
        CONNECT_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([client.connect(transport), timeout]);
    } catch (e) {
      await cleanup();
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });

  async function cleanup() {
    // Hold the child before close(): the transport drops its reference there, and
    // a kill must go through the ChildProcess, never a bare pid that Windows may
    // already have handed to another process. (_process is the SDK's private
    // field; if it is ever renamed, child is undefined and nothing is killed.)
    const child = transport?._process;
    try { await client?.close(); } catch { /* already closed */ }
    // close() ends the child itself; kill only one that is somehow still running.
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    if (home) rmSync(home, { recursive: true, force: true });
  }

  after(cleanup);

  it('lists lint_airtable_code as a read-only tool', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'lint_airtable_code');
    assert.ok(tool, 'lint_airtable_code is registered');
    assert.equal(tool.annotations?.readOnlyHint, true);
  });

  it('reports an unknown formula function with a 1-based line', async () => {
    const r = await client.callTool({ name: 'lint_airtable_code', arguments: { language: 'formula', text: 'NOPE(1)' } });
    assert.notEqual(r.isError, true);
    const body = parse(r);
    assert.equal(body.clean, false);
    assert.equal(body.diagnostics[0].line, 1);
  });

  it('reports a valid formula as clean', async () => {
    const r = await client.callTool({ name: 'lint_airtable_code', arguments: { language: 'formula', text: 'IF(1,2,3)' } });
    assert.notEqual(r.isError, true);
    assert.equal(parse(r).clean, true);
  });

  it('rejects an unknown language as a tool error', async () => {
    const r = await client.callTool({ name: 'lint_airtable_code', arguments: { language: 'nope', text: 'x' } });
    assert.equal(r.isError, true);
  });

  it('has no credentials: a tool that needs Airtable fails, and lint still answers', async () => {
    const tables = await client.callTool({ name: 'list_tables', arguments: { appId: 'appXXXXXXXXXXXXXX' } });
    assert.equal(tables.isError, true);
    // MISSING, not merely an error: a cookie leaking in from the shell fails as
    // BYO_CREDENTIALS_INVALID after a real request to Airtable.
    assert.match(tables.content[0].text, /CREDENTIALS_MISSING/);
    const r = await client.callTool({ name: 'lint_airtable_code', arguments: { language: 'formula', text: 'IF(1,2,3)' } });
    assert.notEqual(r.isError, true);
    assert.equal(parse(r).clean, true);
  });
});
