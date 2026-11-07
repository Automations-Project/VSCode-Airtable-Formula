// scripts/check-mcp-clients.test.mjs  (node --test; no network: main() only runs as the entry point)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAgentsSource, hashAgentsSource, diffSnapshot, formatDriftReport, extractTableRows, checkOffline, recordSnapshot, MIN_AGENTS } from './check-mcp-clients.mjs';

const HELPER = 'import { join } from "path";\nconst home = homedir();\nfunction getGrokHome() {\n  return process.env.GROK_HOME || join(home, ".grok");\n}\n';
const id = i => `agent-${String(i).padStart(2, '0')}`;
function source(n, { edit, helper = HELPER, tail = 'export function getAgentTypes() {\n  return Object.keys(agents);\n}\n' } = {}) {
  const blocks = Array.from({ length: n }, (_, i) => {
    const key = i === 0 ? 'bare' : `"${id(i)}"`;
    const body = `  ${key}: {\n    name: "${i === 0 ? 'bare' : id(i)}",\n    configPath: join(home, ".x${i}", "mcp.json"),\n    nested: {\n      deep: true,\n    },\n  },\n`;
    return edit && edit.index === i ? body.replace('mcp.json', edit.to) : body;
  });
  return `${helper}\nexport const agents: Record<AgentType, AgentConfig> = {\n${blocks.join('\n')}};\n\n${tail}`;
}
const PIN = 'a'.repeat(40);
const LATEST = 'b'.repeat(40);

test('splits the helper section from the agents, bare and quoted keys, ignoring nested keys', () => {
  const { helper, agents } = splitAgentsSource(source(22));
  assert.equal(helper, HELPER.trimEnd());
  assert.equal(agents.length, 22);
  assert.equal(agents[0].id, 'bare');
  assert.equal(agents[21].id, id(21));
  assert.ok(agents[1].block.startsWith(`  "${id(1)}": {`));
  assert.ok(agents[1].block.endsWith('},'));
});

test('CRLF and the code after the table do not change any hash', () => {
  const lf = hashAgentsSource(source(22));
  assert.deepEqual(hashAgentsSource(source(22).replace(/\n/g, '\r\n')), lf);
  assert.deepEqual(hashAgentsSource(source(22, { tail: 'export const other = 1;\n' })), lf);
});

test('dies on fewer than MIN_AGENTS agents or no agents object', () => {
  assert.throws(() => splitAgentsSource(source(MIN_AGENTS - 1)), /extracted 19 agents from agents\.ts, expected at least 20/);
  assert.throws(() => splitAgentsSource('const x = 1;\n'), /no 'export const agents'/);
});

test('reports added, removed, changed and helper changes', () => {
  const snap = { ref: PIN, ...hashAgentsSource(source(22)) };
  const shaped = { ref: PIN, helperSha256: snap.helperSha256, agents: Object.fromEntries(Object.entries(snap.agents).map(([k, v]) => [k, { sha256: v, ported: false, reason: 'x' }])) };
  assert.deepEqual(diffSnapshot(shaped, hashAgentsSource(source(22))), { added: [], removed: [], changed: [], helperChanged: false });
  assert.deepEqual(diffSnapshot(shaped, hashAgentsSource(source(23))).added, [id(22)]);
  assert.deepEqual(diffSnapshot(shaped, hashAgentsSource(source(21))).removed, [id(21)]);
  assert.deepEqual(diffSnapshot(shaped, hashAgentsSource(source(22, { edit: { index: 3, to: 'mcp-v2.json' } }))).changed, [id(3)]);
  assert.equal(diffSnapshot(shaped, hashAgentsSource(source(22, { helper: HELPER.replace('.grok', '.grok2') }))).helperChanged, true);
});

test('the report names every id and links the compare view', () => {
  const report = formatDriftReport({ added: ['x'], removed: [], changed: ['y'], helperChanged: true }, { pinned: PIN, latest: LATEST });
  assert.match(report, /added: {3}x/);
  assert.match(report, /removed: -/);
  assert.match(report, /changed: y/);
  assert.match(report, /helper section changed: yes/);
  assert.ok(report.includes(`https://github.com/neondatabase/add-mcp/compare/${PIN}...${LATEST}`));
});

test('extracts table rows from the TypeScript source as text', () => {
  const ts = "export const MCP_CLIENTS = [\n  { id: 'cursor', upstream: 'cursor', label: 'Cursor',\n  },\n  {\n    id: 'amp', upstream: null, label: 'Amp' },\n  { id: 'codex-cli', upstream: 'codex', label: 'Codex CLI' },\n];\n";
  assert.deepEqual(extractTableRows(ts), [{ id: 'cursor', upstream: 'cursor' }, { id: 'amp', upstream: null }, { id: 'codex-cli', upstream: 'codex' }]);
  assert.throws(() => extractTableRows('export const x = [];'), /no rows found/);
});

const header = `// Ported and modified from neondatabase/add-mcp src/agents.ts\n// at ${PIN}\n// Licensed under the Apache License, Version 2.0;\n`;
const files = { 'packages/extension/src/auto-config/mcp-clients.ts': header, 'packages/extension/src/auto-config/mcp-entry-shapes.ts': header, 'packages/extension/src/auto-config/opencode-layout.ts': header };
const snapshot = {
  ref: PIN, helperSha256: 'c'.repeat(64), oursOnly: ['amp'],
  agents: { codex: { sha256: 'd'.repeat(64), ported: true, ourId: 'codex-cli' }, vscode: { sha256: 'e'.repeat(64), ported: false, reason: 'registered by the extension' } },
};
const rows = [{ id: 'codex-cli', upstream: 'codex' }, { id: 'amp', upstream: null }];

test('offline: a consistent table and snapshot pass', () => {
  assert.deepEqual(checkOffline({ snapshot, rows, files }), []);
  // Two ported agents folded into one row (upstream cline and cline-cli are our cline) pass.
  const folded = { ...snapshot, agents: { ...snapshot.agents, cline: { sha256: 'f'.repeat(64), ported: true, ourId: 'cline' }, 'cline-cli': { sha256: '0'.repeat(64), ported: true, ourId: 'cline' } } };
  assert.deepEqual(checkOffline({ snapshot: folded, rows: [...rows, { id: 'cline', upstream: 'cline' }], files }), []);
});

test('offline: every disagreement is reported', () => {
  const p = (patch) => checkOffline({ snapshot: { ...snapshot, ...patch.snapshot }, rows: patch.rows ?? rows, files: patch.files ?? files }).join('\n');
  assert.match(p({ rows: [{ id: 'amp', upstream: null }] }), /codex.*no row/);
  assert.match(p({ rows: [...rows, { id: 'code', upstream: 'vscode' }] }), /vscode.*not ported/);
  assert.match(p({ rows: [{ id: 'codex', upstream: 'codex' }, rows[1]] }), /codex.*codex-cli/);
  assert.match(p({ snapshot: { agents: { ...snapshot.agents, 'cline-cli': { sha256: '0'.repeat(64), ported: true, ourId: 'cline' } } } }), /cline-cli.*no row/);
  assert.match(p({ rows: [rows[0], { id: 'windsurf-next', upstream: null }] }), /windsurf-next.*oursOnly/);
  assert.match(p({ rows: [rows[0]] }), /amp.*no row/);
  assert.match(p({ snapshot: { agents: { ...snapshot.agents, goose: { sha256: 'f'.repeat(64), ported: false } } } }), /goose.*reason/);
  assert.match(p({ files: { ...files, 'packages/extension/src/auto-config/mcp-clients.ts': '// no header\n' } }), /mcp-clients\.ts.*attribution/);
  assert.match(p({ files: { ...files, 'packages/extension/src/auto-config/opencode-layout.ts': null } }), /opencode-layout\.ts.*missing/);
});

test('record keeps decisions, re-pins hashes, adds new agents unreviewed and drops removed ones', () => {
  const hashed = { helperSha256: '1'.repeat(64), agents: { codex: '2'.repeat(64), zed: '3'.repeat(64) } };
  const next = recordSnapshot(snapshot, hashed, LATEST);
  assert.equal(next.ref, LATEST);
  assert.deepEqual(next.agents.codex, { sha256: '2'.repeat(64), ported: true, ourId: 'codex-cli' });
  assert.deepEqual(next.agents.zed, { sha256: '3'.repeat(64), ported: false, reason: `added upstream at ${LATEST}; not reviewed` });
  assert.equal('vscode' in next.agents, false);
  assert.deepEqual(next.oursOnly, ['amp']);
});
