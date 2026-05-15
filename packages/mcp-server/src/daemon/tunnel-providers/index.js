/**
 * Tunnel provider registry + tunnel-settings.json read/write.
 *
 * This module is the central hub for:
 *   1. Provider registry — getTunnelProvider(), listTunnelProviders()
 *   2. Settings persistence — readTunnelSettings(), writeTunnelSettings()
 *      using the D-03 schema: { enabled, provider, ngrokDomain }
 *
 * D-03 schema (canonical):
 *   { "enabled": boolean, "provider": "cf-quick"|"ngrok"|"cf-named", "ngrokDomain": string|null }
 *
 * Optional pass-through fields written by onTunnelAutoDisable (Plan 06):
 *   { "autoDisabled": boolean, "autoDisabledReason": { "failures": number, "ip": string|null } }
 *   readTunnelSettings preserves these as-is; writeTunnelSettings does not clobber them
 *   unless explicitly provided in the patch.
 *
 * NOT ported from Perplexity:
 *   - readNgrokSettings / writeNgrokSettings — ngrok authtoken lives in VS Code
 *     SecretStorage only (D-02), never on disk.
 *   - Perplexity's { activeProvider, updatedAt } schema — this project uses D-03.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeAtomicWriteFileSync } from '../../safe-write.js';

import { cloudflaredQuickProvider } from './cloudflared-quick.js';
import { cloudflaredNamedProvider } from './cloudflared-named.js';
import { ngrokProvider, NgrokNativeMissingError } from './ngrok.js';

export { NgrokNativeMissingError } from './ngrok.js';

/** @type {readonly string[]} */
const VALID_PROVIDERS = ['cf-quick', 'ngrok', 'cf-named'];

/** @type {Record<string, import('./types.js').TunnelProvider>} */
const REGISTRY = {
  'cf-quick': cloudflaredQuickProvider,
  'ngrok': ngrokProvider,
  'cf-named': cloudflaredNamedProvider,
};

/**
 * Return the provider implementation for the given ID. Throws on unknown IDs.
 *
 * @param {string} id
 * @returns {import('./types.js').TunnelProvider}
 */
export function getTunnelProvider(id) {
  const provider = REGISTRY[id];
  if (!provider) throw new Error(`Unknown tunnel provider: ${id}`);
  return provider;
}

/**
 * List all registered tunnel providers.
 *
 * @returns {import('./types.js').TunnelProvider[]}
 */
export function listTunnelProviders() {
  return Object.values(REGISTRY);
}

// ────────────────────────────────────────────────────────────────────
// Tunnel settings file: <configDir>/tunnel-settings.json
// Holds the user's provider preference and enabled/disabled state.
// Separate from the daemon lockfile — persists across daemon restarts.
// ────────────────────────────────────────────────────────────────────

/**
 * @param {string} configDir
 * @returns {string}
 */
export function getTunnelSettingsPath(configDir) {
  return join(configDir, 'tunnel-settings.json');
}

/**
 * Read tunnel settings from disk. Returns defaults if the file is missing or
 * corrupt. Pass-through fields (autoDisabled, autoDisabledReason) written by
 * onTunnelAutoDisable are included when present.
 *
 * @param {string} configDir
 * @returns {{
 *   enabled: boolean,
 *   provider: string,
 *   ngrokDomain: string|null,
 *   autoDisabled?: boolean,
 *   autoDisabledReason?: { failures: number, ip: string|null } | null,
 * }}
 */
export function readTunnelSettings(configDir) {
  const path = getTunnelSettingsPath(configDir);
  const defaults = { enabled: false, provider: 'cf-quick', ngrokDomain: null, autoDisabled: false, autoDisabledReason: null };
  if (!existsSync(path)) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const result = {
      enabled: parsed.enabled === true,
      provider: VALID_PROVIDERS.includes(parsed.provider) ? parsed.provider : 'cf-quick',
      ngrokDomain: typeof parsed.ngrokDomain === 'string' ? parsed.ngrokDomain : null,
    };
    // Pass-through optional fields written by onTunnelAutoDisable — preserve as-is
    if ('autoDisabled' in parsed) result.autoDisabled = parsed.autoDisabled;
    if ('autoDisabledReason' in parsed) result.autoDisabledReason = parsed.autoDisabledReason;
    return result;
  } catch {
    return defaults;
  }
}

/**
 * Merge patch into persisted tunnel settings and write atomically. Unknown
 * provider IDs in the patch are ignored (previous provider kept). Does not
 * clobber autoDisabled/autoDisabledReason unless they appear in the patch.
 *
 * @param {string} configDir
 * @param {{
 *   enabled?: boolean,
 *   provider?: string,
 *   ngrokDomain?: string|null,
 *   autoDisabled?: boolean,
 *   autoDisabledReason?: { failures: number, ip: string|null } | null,
 * }} patch
 * @returns {{ enabled: boolean, provider: string, ngrokDomain: string|null }}
 */
export function writeTunnelSettings(configDir, patch) {
  const path = getTunnelSettingsPath(configDir);
  const prev = readTunnelSettings(configDir);
  const next = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : prev.enabled,
    provider: VALID_PROVIDERS.includes(patch.provider) ? patch.provider : prev.provider,
    ngrokDomain: 'ngrokDomain' in patch ? (patch.ngrokDomain ?? null) : prev.ngrokDomain,
  };
  // Pass-through autoDisabled/autoDisabledReason if in patch, else carry forward
  if ('autoDisabled' in patch) {
    next.autoDisabled = patch.autoDisabled;
  } else if ('autoDisabled' in prev) {
    next.autoDisabled = prev.autoDisabled;
  }
  if ('autoDisabledReason' in patch) {
    next.autoDisabledReason = patch.autoDisabledReason;
  } else if ('autoDisabledReason' in prev) {
    next.autoDisabledReason = prev.autoDisabledReason;
  }
  mkdirSync(dirname(path), { recursive: true });
  safeAtomicWriteFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}
