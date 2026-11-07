import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BUILTIN_PROMPT_DEFS } from '../mcp/prompt-defs.js';

const workspace = vi.hoisted(() => ({
  isTrusted: true,
  workspaceFolders: [{ uri: { fsPath: '/ws' } }] as { uri: { fsPath: string } }[] | undefined,
}));
// A temp home, so the merged prompts never come from the real ~/.airtable-user-mcp/prompts.json.
const home = vi.hoisted(() => ({ dir: '' }));
vi.mock('vscode', () => ({ workspace }));
vi.mock('../auto-config/ide-detection.js', () => ({ detectInstalledIdes: vi.fn(async () => ['cursor']) }));
vi.mock('os', async importOriginal => ({ ...await importOriginal<typeof import('os')>(), homedir: () => home.dir }));

beforeAll(() => { home.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-env-home-')); });
afterAll(() => fs.rmSync(home.dir, { recursive: true, force: true }));

import { skillEnv } from '../skills/host-env.js';

const context = { extensionPath: '/ext', extension: { packageJSON: { version: '1.2.3' } } } as any;

describe('skillEnv', () => {
  beforeEach(() => {
    workspace.isTrusted = true;
    workspace.workspaceFolders = [{ uri: { fsPath: '/ws' } }];
  });

  it('describes this host for the installer', async () => {
    expect(await skillEnv(context)).toEqual({
      home: home.dir,
      workspaceRoot: '/ws',
      version: '1.2.3',
      skillSourceDir: path.join('/ext', 'dist', 'skills', 'airtable-formula'),
      detectedIdes: ['cursor'],
      xdgConfigHome: process.env.XDG_CONFIG_HOME,
      prompts: { merged: expect.any(Array), builtins: BUILTIN_PROMPT_DEFS },
    });
  });

  it('carries the built-in prompts and the merged list (built-ins plus the user edits)', async () => {
    const custom = { name: 'mine', description: 'd', arguments: [], template: 't' };
    const dir = path.join(home.dir, '.airtable-user-mcp');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompts.json'), JSON.stringify({ custom: [custom] }));
    try {
      const { prompts } = await skillEnv(context);
      expect(prompts.builtins).toEqual(BUILTIN_PROMPT_DEFS);
      expect(prompts.merged.map(p => p.name)).toEqual([...BUILTIN_PROMPT_DEFS.map(p => p.name), 'mine']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has no workspace root in Restricted Mode, so project scope never writes into an untrusted repository', async () => {
    workspace.isTrusted = false;
    expect((await skillEnv(context)).workspaceRoot).toBeNull();
  });

  it('has no workspace root when no folder is open', async () => {
    workspace.workspaceFolders = undefined;
    expect((await skillEnv(context)).workspaceRoot).toBeNull();
  });
});
