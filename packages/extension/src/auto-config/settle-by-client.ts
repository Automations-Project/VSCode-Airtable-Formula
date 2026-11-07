import type { IdeId } from '@airtable-formula/shared';

export interface ClientFailure { ideId: IdeId; label: string; message: string }

/**
 * Runs `fn` for every client at once and waits for all of them. One client's failure (an
 * unparsable config file) fails that client only: the others still run, and the caller logs
 * `failed` and reports `ok`. Its own module, with no imports, so every caller (extension.ts,
 * DashboardProvider) gets the real one even where a test mocks the rest of auto-config.
 */
export async function settleByClient<T extends { ideId: IdeId; label: string }>(
  statuses: readonly T[],
  fn: (status: T) => Promise<unknown>,
): Promise<{ ok: T[]; failed: ClientFailure[] }> {
  const results = await Promise.allSettled(statuses.map(async s => fn(s)));
  const ok: T[] = [];
  const failed: ClientFailure[] = [];
  results.forEach((r, i) => {
    const { ideId, label } = statuses[i];
    if (r.status === 'fulfilled') ok.push(statuses[i]);
    else failed.push({ ideId, label, message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  return { ok, failed };
}
