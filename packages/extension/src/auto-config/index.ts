import * as path from 'path';
import * as fs from 'fs';
import type { IdeId, IdeStatus, AiFiles } from '@airtable-formula/shared';
import { IDE_CONFIGS } from './ide-configs.js';
import { detectInstalledIdes, isIdeInstalled, readConfigFile, writeConfigAtomic, mergeServerEntry, removeServerEntry } from './ide-detection.js';

const MCP_SERVER_NAME = 'airtable-user-mcp';

export function buildServerEntry(serverPath: string): Record<string, unknown> {
  // NODE_PATH points to dist/node_modules so patchright (vendored separately) is resolvable
  const nodeModulesPath = path.resolve(path.dirname(serverPath), '..', 'node_modules');
  return {
    command: 'node',
    args: [serverPath],
    env: {
      AIRTABLE_HEADLESS_ONLY: '1',
      NODE_PATH: nodeModulesPath,
    },
  };
}

export function buildNpxServerEntry(): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['-y', 'airtable-user-mcp'],
    env: { AIRTABLE_HEADLESS_ONLY: '1' },
  };
}

export async function configureMcpForIde(ideId: IdeId, serverPath: string, serverEntry?: Record<string, unknown>): Promise<void> {
  const cfg = IDE_CONFIGS[ideId];
  const existing = await readConfigFile(cfg.mcpConfigPath);
  const entry = serverEntry ?? buildServerEntry(serverPath);
  const merged = mergeServerEntry(existing, cfg.mcpServersKey, MCP_SERVER_NAME, entry);
  await writeConfigAtomic(cfg.mcpConfigPath, merged);
}

export async function unconfigureMcpForIde(ideId: IdeId): Promise<void> {
  const cfg = IDE_CONFIGS[ideId];
  const existing = await readConfigFile(cfg.mcpConfigPath);
  const cleaned = removeServerEntry(existing, cfg.mcpServersKey, MCP_SERVER_NAME);
  await writeConfigAtomic(cfg.mcpConfigPath, cleaned);
}

export async function isMcpConfigured(ideId: IdeId): Promise<boolean> {
  try {
    const cfg = IDE_CONFIGS[ideId];
    const existing = await readConfigFile(cfg.mcpConfigPath);
    const parts = cfg.mcpServersKey.split('.');
    let cur: unknown = existing;
    for (const p of parts) {
      if (typeof cur !== 'object' || cur === null) return false;
      cur = (cur as Record<string, unknown>)[p];
    }
    return typeof cur === 'object' && cur !== null && MCP_SERVER_NAME in (cur as object);
  } catch { return false; }
}

export async function getMcpHealth(ideId: IdeId): Promise<{ configured: boolean; healthy: boolean }> {
  try {
    const cfg = IDE_CONFIGS[ideId];
    const existing = await readConfigFile(cfg.mcpConfigPath);
    const parts = cfg.mcpServersKey.split('.');
    let cur: unknown = existing;
    for (const p of parts) {
      if (typeof cur !== 'object' || cur === null) return { configured: false, healthy: false };
      cur = (cur as Record<string, unknown>)[p];
    }
    if (typeof cur !== 'object' || cur === null || !(MCP_SERVER_NAME in (cur as object))) {
      return { configured: false, healthy: false };
    }
    const entry = (cur as Record<string, unknown>)[MCP_SERVER_NAME] as Record<string, unknown>;
    if (entry.command === 'npx') return { configured: true, healthy: true };
    const args = entry.args as string[] | undefined;
    if (args && args.length > 0) {
      try {
        await fs.promises.access(args[0]);
        return { configured: true, healthy: true };
      } catch {
        return { configured: true, healthy: false };
      }
    }
    return { configured: true, healthy: true };
  } catch { return { configured: false, healthy: false }; }
}

function emptyAiFiles(): AiFiles {
  return { skills: 'missing', rules: 'missing', workflows: 'missing', agents: 'missing' };
}

export async function getIdeStatus(ideId: IdeId): Promise<IdeStatus> {
  const cfg = IDE_CONFIGS[ideId];
  const detected = await isIdeInstalled(ideId);
  const health = detected ? await getMcpHealth(ideId) : { configured: false, healthy: false };
  return {
    ideId,
    label: cfg.label,
    detected,
    mcpConfigured: health.configured,
    mcpServerHealthy: health.configured ? health.healthy : undefined,
    aiFiles: emptyAiFiles(),
  };
}

export async function getAllIdeStatuses(): Promise<IdeStatus[]> {
  const ids = Object.keys(IDE_CONFIGS) as IdeId[];
  return Promise.all(ids.map(getIdeStatus));
}

export { detectInstalledIdes, isIdeInstalled, readConfigFile, writeConfigAtomic, mergeServerEntry, removeServerEntry } from './ide-detection.js';
export { IDE_CONFIGS } from './ide-configs.js';
export type { IdeConfig } from './ide-configs.js';
