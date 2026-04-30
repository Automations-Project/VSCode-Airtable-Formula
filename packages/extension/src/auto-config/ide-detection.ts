import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { IdeId } from '@airtable-formula/shared';
import { IDE_CONFIGS } from './ide-configs.js';

export function getNestedKey(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((cur, key) => {
    if (cur && typeof cur === 'object') return (cur as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function setNestedKey(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

export function mergeServerEntry(
  config: Record<string, unknown>,
  serversKey: string,
  serverName: string,
  serverEntry: Record<string, unknown>
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const existing = (getNestedKey(clone, serversKey) ?? {}) as Record<string, unknown>;
  existing[serverName] = serverEntry;
  setNestedKey(clone, serversKey, existing);
  return clone;
}

export function removeServerEntry(
  config: Record<string, unknown>,
  serversKey: string,
  serverName: string,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const existing = (getNestedKey(clone, serversKey) ?? {}) as Record<string, unknown>;
  delete existing[serverName];
  setNestedKey(clone, serversKey, existing);
  return clone;
}

export async function isIdeInstalled(ideId: IdeId): Promise<boolean> {
  const config = IDE_CONFIGS[ideId];
  for (const p of config.detectionPaths) {
    try {
      await fs.promises.access(p);
      return true;
    } catch { /* not found */ }
  }
  return false;
}

export async function detectInstalledIdes(): Promise<IdeId[]> {
  const ids = Object.keys(IDE_CONFIGS) as IdeId[];
  const results = await Promise.all(ids.map(id => isIdeInstalled(id).then(ok => ok ? id : null)));
  return results.filter((id): id is IdeId => id !== null);
}

export async function readConfigFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Config file at ${filePath} is malformed JSON — aborting to prevent data loss.`);
  }
}

export async function writeConfigAtomic(filePath: string, config: Record<string, unknown>): Promise<void> {
  // H10 — unique random suffix per write so two concurrent calls for the same
  // target file (e.g. a double-click on "Setup") cannot collide on the tmp
  // path and truncate each other's output.
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}
