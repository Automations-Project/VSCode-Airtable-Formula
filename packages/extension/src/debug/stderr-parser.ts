import type { DebugEvent, DebugCollector } from './collector.js';

const DEBUG_PREFIX = '[DEBUG]';

// H8 — hard cap on a single debug line. A malformed MCP emit (or an attacker-
// controlled tool result reflected into a trace) could otherwise be a 10-MB
// blob that stalls JSON.parse and the extension host's main thread.
const MAX_DEBUG_LINE_BYTES = 64 * 1024;

export function parseStderrLine(line: string, collector: DebugCollector): boolean {
  if (!line.startsWith(DEBUG_PREFIX)) return false;

  // Still return `true` so the caller strips this line from the non-debug
  // stream; it IS a debug line, just a malformed / oversized one.
  if (line.length > MAX_DEBUG_LINE_BYTES) {
    return true;
  }

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
