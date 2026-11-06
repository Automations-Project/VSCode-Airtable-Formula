/**
 * Tests for the pure parser behind `pnpm generate:agent-dirs`.
 *
 * Run directly with `node --test scripts/generate-agent-dirs.test.mjs`, or via
 * `pnpm test:scripts`. No network: `main()` only runs when the generator is the
 * process entry point, so importing it here never fetches.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAgentsSource,
  assertExpectedShape,
} from './generate-agent-dirs.mjs';

const FIXTURE = `
const home = homedir();
const configHome = xdgConfig ?? join(home, '.config');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');
export const agents = {
  cursor: { name: 'cursor', displayName: 'Cursor', skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.cursor/skills'), detectInstalled: async () => true },
  opencode: { name: 'opencode', displayName: 'OpenCode', skillsDir: '.agents/skills',
    showInUniversalList: false, globalSkillsDir: join(configHome, 'opencode/skills') },
  'claude-code': { name: 'claude-code', displayName: 'Claude Code', skillsDir: '.claude/skills',
    globalSkillsDir: join(claudeHome, 'skills') },
  codex: { name: 'codex', displayName: 'Codex', skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents', 'skills') },
  eve: { name: 'eve', displayName: 'Eve', skillsDir: '.eve/skills', globalSkillsDir: undefined },
  antigravity: { name: 'antigravity', displayName: 'Antigravity', skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/config/skills'), globalReadsCanonical: false, showInUniversalPrompt: false },
  openclaw: { name: 'openclaw', displayName: 'OpenClaw', skillsDir: '.agents/skills',
    globalSkillsDir: getOpenClawGlobalSkillsDir() },
};`;

test('maps home, configHome and env-home bases to ~ paths', () => {
  const { agents } = parseAgentsSource(FIXTURE);
  const byId = Object.fromEntries(agents.map(a => [a.id, a]));
  assert.equal(byId.cursor.global, '~/.cursor/skills');
  assert.equal(byId.opencode.global, '~/.config/opencode/skills');
  assert.equal(byId['claude-code'].global, '~/.claude/skills');
  assert.equal(byId.codex.global, '~/.agents/skills');
  assert.equal(byId.eve.global, null);
  assert.equal(byId.cursor.universal, true);
  assert.equal(byId['claude-code'].universal, false);
  assert.equal(byId.cursor.name, 'Cursor');
  assert.equal(byId.cursor.readsCanonicalGlobally, true);
  assert.equal(byId.antigravity.readsCanonicalGlobally, false);        // universal, but flagged
  assert.equal(byId['claude-code'].readsCanonicalGlobally, false);     // not universal
  assert.deepEqual(agents.map(a => a.id), ['antigravity', 'claude-code', 'codex', 'cursor', 'eve', 'opencode']);
});

test('reports unparseable globalSkillsDir entries as skipped with the expression', () => {
  const { skipped } = parseAgentsSource(FIXTURE);
  assert.deepEqual(skipped, [{ id: 'openclaw', reason: 'unparsed globalSkillsDir: getOpenClawGlobalSkillsDir()' }]);
});

test('field order inside an entry does not matter', () => {
  const { agents } = parseAgentsSource(FIXTURE);
  assert.equal(agents.find(a => a.id === 'opencode').project, '.agents/skills');
});

test('assertExpectedShape fails closed on an unexpected skip set or too few agents', () => {
  const parsed = parseAgentsSource(FIXTURE);                       // skipped = ['openclaw'] only, 6 agents
  assert.throws(() => assertExpectedShape(parsed), /skipped ids \[openclaw\] != expected \[openclaw, reasonix\]/);
  const padded = { agents: Array.from({ length: 70 }, (_, i) => ({ ...parsed.agents[0], id: `a${i}` })),
                   skipped: [{ id: 'openclaw', reason: 'x' }, { id: 'reasonix', reason: 'y' }] };
  assert.doesNotThrow(() => assertExpectedShape(padded));
  assert.throws(() => assertExpectedShape({ ...padded, agents: padded.agents.slice(0, 69) }), /69 agents parsed, expected at least 70/);
});
