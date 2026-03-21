import * as path from 'path';
import type { IdeId, IdeStatus, AiFiles } from '@airtable-formula/shared';
import { IDE_CONFIGS } from './ide-configs.js';
import { detectInstalledIdes, isIdeInstalled, readConfigFile, writeConfigAtomic, mergeServerEntry } from './ide-detection.js';

const MCP_SERVER_NAME = 'mcp-internal-airtable';

export function buildServerEntry(serverPath: string): Record<string, unknown> {
  return {
    command: process.execPath,
    args: [serverPath],
    env: { AIRTABLE_HEADLESS_ONLY: '1' },
  };
}

export async function configureMcpForIde(ideId: IdeId, serverPath: string): Promise<void> {
  const cfg = IDE_CONFIGS[ideId];
  const existing = await readConfigFile(cfg.mcpConfigPath);
  const merged = mergeServerEntry(existing, cfg.mcpServersKey, MCP_SERVER_NAME, buildServerEntry(serverPath));
  await writeConfigAtomic(cfg.mcpConfigPath, merged);
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

function emptyAiFiles(): AiFiles {
  return { skills: 'missing', rules: 'missing', workflows: 'missing', agents: 'missing' };
}

export async function getIdeStatus(ideId: IdeId): Promise<IdeStatus> {
  const cfg = IDE_CONFIGS[ideId];
  const detected = await isIdeInstalled(ideId);
  const mcpConfigured = detected ? await isMcpConfigured(ideId) : false;
  return { ideId, label: cfg.label, detected, mcpConfigured, aiFiles: emptyAiFiles() };
}

export async function getAllIdeStatuses(): Promise<IdeStatus[]> {
  const ids = Object.keys(IDE_CONFIGS) as IdeId[];
  return Promise.all(ids.map(getIdeStatus));
}

export { detectInstalledIdes, isIdeInstalled, readConfigFile, writeConfigAtomic, mergeServerEntry } from './ide-detection.js';
export { IDE_CONFIGS } from './ide-configs.js';
export type { IdeConfig } from './ide-configs.js';
