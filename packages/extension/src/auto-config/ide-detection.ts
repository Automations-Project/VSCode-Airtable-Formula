import * as fs from 'fs';
import { IDE_IDS, type IdeId } from '@airtable-formula/shared';
import { hostPathContext, type PathContext } from './mcp-clients.js';
import { detectionPathsFor } from './ide-configs.js';

/** True when any of the IDE's detection paths exists. `exists` is injectable so tests stay inside a temp home. */
export async function isIdeInstalled(
  ideId: IdeId,
  ctx: PathContext = hostPathContext(),
  exists: (p: string) => boolean = fs.existsSync,
): Promise<boolean> {
  return detectionPathsFor(ideId, ctx).some((p) => exists(p));
}

export async function detectInstalledIdes(ctx: PathContext = hostPathContext()): Promise<IdeId[]> {
  const results = await Promise.all(IDE_IDS.map(id => isIdeInstalled(id, ctx).then(ok => ok ? id : null)));
  return results.filter((id): id is IdeId => id !== null);
}
