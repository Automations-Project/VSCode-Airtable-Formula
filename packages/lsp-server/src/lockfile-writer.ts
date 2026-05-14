import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Atomically update the port_lsp field in daemon.lock.
 * Minimal duplication of lockfile.js replace() — write-only subset.
 * Uses writeFileSync(tmpPath) + renameSync(tmpPath, lockPath) to avoid partial writes.
 *
 * Returns false if the lockfile does not exist yet (daemon not yet started — safe to skip).
 *
 * Implements T-06-03-02: Atomic write preserves existing daemon fields via spread.
 */
export function writeLspPort(lockPath: string, port: number): boolean {
  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  } catch {
    // Lockfile not yet written by daemon — not an error, LSP runs standalone
    return false;
  }
  const updated = { ...existing, port_lsp: port };
  const tempPath = `${lockPath}.lsp.tmp`;
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(tempPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  renameSync(tempPath, lockPath); // atomic replace (lockfile.js lines 121-123 pattern)
  return true;
}
