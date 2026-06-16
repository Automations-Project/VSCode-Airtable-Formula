import { join } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { syncDir } from './idmap.js';
import { safeAtomicWriteFileSync } from '../safe-write.js';

function journalPath(sourceBaseId, destBaseId, planId) {
  return join(syncDir(sourceBaseId, destBaseId), `journal-${planId}.json`);
}
export function newJournal(planId, startedAt) {
  return { planId, startedAt, actions: [] };
}
export function isDone(journal, idx) {
  return journal.actions.some((a) => a.idx === idx && a.status === 'done');
}
function upsert(journal, entry) {
  const i = journal.actions.findIndex((a) => a.idx === entry.idx);
  if (i >= 0) journal.actions[i] = entry; else journal.actions.push(entry);
}
export function recordDone(journal, idx, kind, destId) {
  upsert(journal, { idx, kind, status: 'done', destId });
}
export function recordFailed(journal, idx, kind, error) {
  upsert(journal, { idx, kind, status: 'failed', error });
}
export function saveJournal(sourceBaseId, destBaseId, journal) {
  mkdirSync(syncDir(sourceBaseId, destBaseId), { recursive: true });
  safeAtomicWriteFileSync(journalPath(sourceBaseId, destBaseId, journal.planId), JSON.stringify(journal, null, 2));
}
export function loadJournal(sourceBaseId, destBaseId, planId) {
  const p = journalPath(sourceBaseId, destBaseId, planId);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
