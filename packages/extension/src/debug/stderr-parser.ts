import type { DebugEvent, DebugCollector } from './collector.js';

const DEBUG_PREFIX = '[DEBUG]';

export function parseStderrLine(line: string, collector: DebugCollector): boolean {
  if (!line.startsWith(DEBUG_PREFIX)) return false;

  try {
    const json = line.slice(DEBUG_PREFIX.length);
    const event = JSON.parse(json) as DebugEvent;
    if (event.ts && event.source && event.category && event.event) {
      collector.push(event);
    }
  } catch {
    // Malformed debug line — ignore silently
  }

  return true;
}

export function processStderrChunk(chunk: string, collector: DebugCollector): string {
  const lines = chunk.split('\n');
  const nonDebug: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!parseStderrLine(trimmed, collector)) {
      nonDebug.push(line);
    }
  }

  return nonDebug.join('\n');
}
