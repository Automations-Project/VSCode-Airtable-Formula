import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';

const workspace = vi.hoisted(() => ({
  isTrusted: true,
  workspaceFolders: [{ uri: { fsPath: '/ws' } }] as { uri: { fsPath: string } }[] | undefined,
}));
vi.mock('vscode', () => ({ workspace }));
vi.mock('../auto-config/ide-detection.js', () => ({ detectInstalledIdes: vi.fn(async () => ['cursor']) }));

import { skillEnv } from '../skills/host-env.js';

const context = { extensionPath: '/ext', extension: { packageJSON: { version: '1.2.3' } } } as any;

describe('skillEnv', () => {
  beforeEach(() => {
    workspace.isTrusted = true;
    workspace.workspaceFolders = [{ uri: { fsPath: '/ws' } }];
  });

  it('describes this host for the installer', async () => {
    expect(await skillEnv(context)).toEqual({
      home: os.homedir(),
      workspaceRoot: '/ws',
      version: '1.2.3',
      skillSourceDir: path.join('/ext', 'dist', 'skills', 'airtable-formula'),
      detectedIdes: ['cursor'],
      xdgConfigHome: process.env.XDG_CONFIG_HOME,
    });
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
