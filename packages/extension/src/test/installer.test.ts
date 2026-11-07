import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Real fs throughout; renameSync is wrapped so one test can make a single rename fail.
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import {
  expandHome, resolveTargets, installSkill, checkSkill, removeSkill, listSkillClients,
  type SkillEnv,
} from '../skills/installer.js';

let root: string;
let home: string;
let ws: string;
let src: string;
let env: SkillEnv;

const builtinRecipe = { name: 'airtable-builtin-recipe', description: 'A built-in', arguments: [], template: 'Do the built-in thing' };
const customRecipe = { name: 'my-custom-recipe', description: 'A custom one', arguments: [], template: 'Do my thing' };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'airtable-skill-'));
  home = path.join(root, 'home');
  ws = path.join(root, 'ws');
  src = path.join(root, 'src', 'airtable-formula');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(path.join(src, 'references'), { recursive: true });
  fs.writeFileSync(path.join(src, 'SKILL.md'),
    '---\nname: airtable-formula\ndescription: test skill\nmetadata:\n  version: 0.0.0-dev\n  source: test\n---\n\n# Airtable Formula\n');
  fs.writeFileSync(path.join(src, 'references', 'rules.md'), '# Rules\n');
  env = {
    home, workspaceRoot: ws, version: '2.3.0', skillSourceDir: src, detectedIdes: ['cursor', 'claude-code'],
    prompts: { merged: [builtinRecipe, customRecipe], builtins: [builtinRecipe] },
  };
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('skill installer', () => {
  it('global targets: canonical dir + detected IDE dirs + agents whose parent dir exists', () => {
    fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });     // present, not an IDE we detect
    fs.mkdirSync(path.join(home, '.config'), { recursive: true });     // parent of configHome agents: must NOT count
    const { targets, byIde } = resolveTargets('global', env);
    expect(targets).toEqual(expect.arrayContaining([
      path.join(home, '.agents', 'skills'), path.join(home, '.cursor', 'skills'),
      path.join(home, '.claude', 'skills'), path.join(home, '.gemini', 'skills')]));
    expect(targets).not.toContain(path.join(home, '.config', 'opencode', 'skills'));
    expect(targets).not.toContain(path.join(home, '.codeium', 'windsurf', 'skills'));
    expect(new Set(targets).size).toBe(targets.length);
    expect(byIde.cursor).toEqual([path.join(home, '.cursor', 'skills')]);
  });

  it('project targets: canonical dir + non-universal project dirs of detected IDEs only', () => {
    const { targets } = resolveTargets('project', env);
    expect(targets).toEqual([path.join(ws, '.agents', 'skills'), path.join(ws, '.claude', 'skills')]);
  });

  it('expandHome honours XDG_CONFIG_HOME', () => {
    expect(expandHome('~/.config/opencode/skills', { home, xdgConfigHome: '/x' })).toBe(path.join('/x', 'opencode', 'skills'));
  });

  it('install writes the versioned skill into every target and reports the dirs', async () => {
    const r = await installSkill('global', env);
    expect(r.failed).toEqual([]);
    const skill = fs.readFileSync(path.join(home, '.cursor', 'skills', 'airtable-formula', 'SKILL.md'), 'utf8');
    expect(skill).toContain('version: 2.3.0');
    expect(skill).not.toContain('0.0.0-dev');
    expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'airtable-formula', 'references', 'rules.md'))).toBe(true);
    expect(r.written).toContain(path.join(home, '.cursor', 'skills', 'airtable-formula'));
  });

  it('install is atomic: replaces an old folder wholesale and clears stale tmp dirs, never a live process\'s', async () => {
    const target = path.join(home, '.cursor', 'skills');
    fs.mkdirSync(path.join(target, 'airtable-formula'), { recursive: true });
    fs.writeFileSync(path.join(target, 'airtable-formula', 'AGENT.md'), 'old');
    fs.mkdirSync(path.join(target, `.airtable-formula.tmp-${process.pid}`), { recursive: true });
    fs.mkdirSync(path.join(target, '.airtable-formula.tmp-424242'), { recursive: true });   // left by a crashed install (dead pid)
    const live = `.airtable-formula.tmp-old-${process.ppid}`;   // another window's swap in flight (its pid is alive)
    fs.mkdirSync(path.join(target, live), { recursive: true });
    await installSkill('global', env);
    expect(fs.existsSync(path.join(target, 'airtable-formula', 'AGENT.md'))).toBe(false);
    expect(fs.readFileSync(path.join(target, 'airtable-formula', 'SKILL.md'), 'utf8')).toContain('version: 2.3.0');
    expect(fs.readdirSync(target).sort()).toEqual([live, 'airtable-formula'].sort());
  });

  it('install keeps the previous folder when swapping in the new one fails', async () => {
    await installSkill('global', env);
    const target = path.join(home, '.cursor', 'skills');
    const rename = vi.mocked(fs.renameSync);
    const real = rename.getMockImplementation()!;
    rename.mockImplementation((from, to) => {
      if (String(to) === path.join(target, 'airtable-formula') && path.basename(String(from)) === `.airtable-formula.tmp-${process.pid}`) {
        throw Object.assign(new Error('EPERM: simulated'), { code: 'EPERM' });
      }
      return real(from, to);
    });
    try {
      const r = await installSkill('global', { ...env, version: '2.4.0' });
      expect(r.failed.map(f => f.dir)).toEqual([target]);
    } finally {
      rename.mockImplementation(real);
    }
    expect(fs.readFileSync(path.join(target, 'airtable-formula', 'SKILL.md'), 'utf8')).toContain('version: 2.3.0');
    expect(fs.existsSync(path.join(target, 'airtable-formula', 'references', 'rules.md'))).toBe(true);
    expect(fs.readdirSync(target)).toEqual(['airtable-formula']);
  });

  it('global install writes references/prompts.md with the merged prompts', async () => {
    const r = await installSkill('global', env);
    expect(r.failed).toEqual([]);
    const md = fs.readFileSync(path.join(home, '.cursor', 'skills', 'airtable-formula', 'references', 'prompts.md'), 'utf8');
    expect(md).toContain('## airtable-builtin-recipe');
    expect(md).toContain('## my-custom-recipe');
  });

  it('project install writes built-ins only, never the custom prompts', async () => {
    const r = await installSkill('project', env);
    expect(r.failed).toEqual([]);
    const md = fs.readFileSync(path.join(ws, '.claude', 'skills', 'airtable-formula', 'references', 'prompts.md'), 'utf8');
    expect(md).toContain('## airtable-builtin-recipe');
    expect(md).not.toContain('## my-custom-recipe');
  });

  it('the recipes file is inside the swapped folder, not written after it', async () => {
    const target = path.join(home, '.cursor', 'skills');
    const rename = vi.mocked(fs.renameSync);
    const real = rename.getMockImplementation()!;
    rename.mockImplementation((from, to) => {
      if (String(to) === path.join(target, 'airtable-formula') && path.basename(String(from)) === `.airtable-formula.tmp-${process.pid}`) {
        throw Object.assign(new Error('EPERM: simulated'), { code: 'EPERM' });
      }
      return real(from, to);
    });
    try {
      const r = await installSkill('global', env);
      expect(r.failed.map(f => f.dir)).toContain(target);
    } finally {
      rename.mockImplementation(real);
    }
    expect(fs.existsSync(path.join(target, 'airtable-formula'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'airtable-formula', 'references', 'prompts.md'))).toBe(false);
  });

  it('install continues past an unwritable target and reports it', async () => {
    fs.writeFileSync(path.join(home, '.agents'), 'not a dir');       // makes ~/.agents/skills impossible
    const r = await installSkill('global', env);
    expect(r.failed.map(f => f.dir)).toEqual([path.join(home, '.agents', 'skills')]);
    expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'airtable-formula', 'SKILL.md'))).toBe(true);
  });

  it('project scope with no workspace is a no-op', async () => {
    const r = await installSkill('project', { ...env, workspaceRoot: null });
    expect(r).toEqual({ written: [], failed: [], noWorkspace: true });
    expect(fs.existsSync(path.join(home, '.agents'))).toBe(false);
  });

  it('project install writes the Cursor pointer rule and deletes legacy files; global does neither', async () => {
    const legacy = path.join(ws, '.clinerules', 'airtable-formula-rules.md');
    fs.mkdirSync(path.dirname(legacy), { recursive: true }); fs.writeFileSync(legacy, 'x');
    await installSkill('global', env);
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.existsSync(path.join(ws, '.cursor', 'rules', 'airtable-formula.mdc'))).toBe(false);
    await installSkill('project', env);
    expect(fs.existsSync(legacy)).toBe(false);
    const mdc = fs.readFileSync(path.join(ws, '.cursor', 'rules', 'airtable-formula.mdc'), 'utf8');
    expect(mdc).toMatch(/^---\n[\s\S]*globs: \["\*\*\/\*\.formula"\][\s\S]*alwaysApply: false\n---\n/);
    expect(mdc).toContain('.agents/skills/airtable-formula/SKILL.md');
    expect(mdc).toContain('2.3.0');
  });

  it('project install refuses to follow a symlink inside the workspace', async () => {
    const elsewhere = path.join(root, 'elsewhere');                   // outside ws: must stay untouched
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.mkdirSync(path.join(ws, '.cursor'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(ws, '.cursor', 'rules'), 'junction');
    const outsideLegacy = path.join(root, 'elsewhere-cline');         // a legacy file reached through a link is not deleted
    fs.mkdirSync(outsideLegacy, { recursive: true });
    fs.writeFileSync(path.join(outsideLegacy, 'airtable-formula-rules.md'), 'theirs');
    fs.symlinkSync(outsideLegacy, path.join(ws, '.clinerules'), 'junction');
    const r = await installSkill('project', env);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    expect(r.failed.some(f => f.message.startsWith('refused:'))).toBe(true);
    expect(fs.existsSync(path.join(outsideLegacy, 'airtable-formula-rules.md'))).toBe(true);
    expect(fs.existsSync(path.join(ws, '.agents', 'skills', 'airtable-formula', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(ws, '.claude', 'skills', 'airtable-formula', 'SKILL.md'))).toBe(true);
  });

  it('project install and remove refuse a symlinked skills dir and still handle the real ones', async () => {
    const outside = path.join(root, 'outside');
    const precious = path.join(outside, 'airtable-formula', 'precious.txt');
    fs.mkdirSync(path.dirname(precious), { recursive: true });
    fs.writeFileSync(precious, 'keep');
    fs.mkdirSync(path.join(ws, '.agents'), { recursive: true });
    fs.symlinkSync(outside, path.join(ws, '.agents', 'skills'), 'junction');
    const claude = path.join(ws, '.claude', 'skills', 'airtable-formula');
    const pointer = path.join(ws, '.cursor', 'rules', 'airtable-formula.mdc');

    const r = await installSkill('project', env);
    expect(r.failed).toContainEqual({ dir: path.join(ws, '.agents', 'skills'), message: expect.stringMatching(/^refused:/) });
    expect(fs.existsSync(precious)).toBe(true);
    expect(fs.existsSync(path.join(claude, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(pointer)).toBe(true);

    const rm = await removeSkill('project', env);
    expect(fs.existsSync(precious)).toBe(true);
    expect(fs.existsSync(claude)).toBe(false);
    expect(fs.existsSync(pointer)).toBe(false);
    expect(rm.removed).toContain(claude);
  });

  it('check reports installed / outdated / missing / unsupported per IDE', async () => {
    await installSkill('global', env);
    const target = path.join(home, '.claude', 'skills', 'airtable-formula', 'SKILL.md');
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('version: 2.3.0', 'version: 2.2.0'));
    const s = await checkSkill('global', env);
    expect(s.cursor).toEqual({ status: 'installed', version: '2.3.0' });
    expect(s['claude-code']).toEqual({ status: 'outdated', version: '2.2.0' });
    expect(s.cline.status).toBe('installed');                       // reads ~/.agents/skills
    expect(s['claude-desktop']).toEqual({ status: 'unsupported' });
    fs.rmSync(path.join(home, '.cursor', 'skills', 'airtable-formula'), { recursive: true });
    expect((await checkSkill('global', env)).cursor).toEqual({ status: 'missing' });
  });

  it('check treats a SKILL.md without a version line as outdated', async () => {
    await installSkill('global', env);
    fs.writeFileSync(path.join(home, '.cursor', 'skills', 'airtable-formula', 'SKILL.md'), '# edited');
    expect((await checkSkill('global', env)).cursor).toEqual({ status: 'outdated' });
  });

  it('remove deletes only our folder (and the pointer rule in project scope)', async () => {
    await installSkill('global', env);
    fs.writeFileSync(path.join(home, '.cursor', 'skills', 'other.md'), 'keep');
    const r = await removeSkill('global', env);
    expect(r.removed).toContain(path.join(home, '.cursor', 'skills', 'airtable-formula'));
    expect(fs.readdirSync(path.join(home, '.cursor', 'skills'))).toEqual(['other.md']);
  });

  it('listSkillClients: standard folder first, found clients with status, the rest absent and grouped by canonical', async () => {
    fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
    await installSkill('global', env);
    const clients = await listSkillClients('global', env);
    expect(clients[0]).toEqual({ id: 'agents', name: 'Standard skills folder', dir: '~/.agents/skills', status: 'installed', canonical: true });
    expect(clients.slice(1, 3).map(c => c.id)).toEqual(['cursor', 'claude-code']);     // detection order
    const byId = Object.fromEntries(clients.map(c => [c.id, c]));
    expect(byId.cursor).toMatchObject({ ideId: 'cursor', dir: '~/.cursor/skills', status: 'installed', canonical: true });
    expect(byId['gemini-cli']).toMatchObject({ dir: '~/.gemini/skills', status: 'installed' });
    expect(byId['gemini-cli'].ideId).toBeUndefined();
    expect(byId.codex).toMatchObject({ status: 'absent', canonical: true });            // ~/.agents/skills exists now, but codex-cli is not detected
    expect(byId.devin).toMatchObject({ status: 'absent', canonical: false });
    expect(byId.antigravity).toMatchObject({ status: 'absent', canonical: false });     // universal but does not read ~/.agents/skills
    expect((await listSkillClients('global', { ...env, detectedIdes: ['codex-cli'] })).find(c => c.id === 'codex'))
      .toMatchObject({ ideId: 'codex-cli', dir: '~/.agents/skills', status: 'installed' });
  });

  it('listSkillClients: project scope uses workspace-relative dirs and is empty without a workspace', async () => {
    await installSkill('project', env);
    const clients = await listSkillClients('project', env);
    expect(clients.filter(c => c.status !== 'absent').map(c => [c.id, c.dir, c.status])).toEqual([
      ['agents', '.agents/skills', 'installed'], ['cursor', '.agents/skills', 'installed'], ['claude-code', '.claude/skills', 'installed']]);
    expect(await listSkillClients('project', { ...env, workspaceRoot: null })).toEqual([]);
  });

  it('concurrent installs share one in-flight run', async () => {
    const [a, b] = await Promise.all([installSkill('global', env), installSkill('global', env)]);
    expect(a).toBe(b);
  });
});
