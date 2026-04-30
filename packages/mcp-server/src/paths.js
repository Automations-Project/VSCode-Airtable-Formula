/**
 * Path resolution for the MCP server's per-user state.
 *
 * Resolution order:
 *   1. AIRTABLE_USER_MCP_HOME — advertised in cli.js --help and in server.json
 *      as the canonical override. When set, all per-user state (tool-config
 *      file, browser profile) lives under this directory.
 *   2. AIRTABLE_PROFILE_DIR — legacy override, scoped to the browser profile
 *      directory only. Respected when set so existing deployments keep working,
 *      but new callers should prefer AIRTABLE_USER_MCP_HOME.
 *   3. `~/.airtable-user-mcp` — default.
 */
import path from 'node:path';
import os from 'node:os';

export function getHomeDir() {
  return process.env.AIRTABLE_USER_MCP_HOME || path.join(os.homedir(), '.airtable-user-mcp');
}

export function getProfileDir() {
  if (process.env.AIRTABLE_PROFILE_DIR) return process.env.AIRTABLE_PROFILE_DIR;
  return path.join(getHomeDir(), '.chrome-profile');
}

export function getToolConfigPath() {
  return path.join(getHomeDir(), 'tools-config.json');
}
