/**
 * Reads and writes ~/.airtable-user-mcp/prompts.json.
 * The MCP server reads this synchronously (fresh per request) — the file is tiny.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getHomeDir } from './paths.js';
import { safeAtomicWriteFileSync } from './safe-write.js';

function configPath() {
  return getHomeDir() + '/prompts.json';
}

function empty() {
  return { overrides: {}, custom: [] };
}

export function readPromptsConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return empty();
  }
}

export function writePromptsConfig(config) {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  safeAtomicWriteFileSync(p, JSON.stringify(config, null, 2) + '\n', 'utf8');
}
