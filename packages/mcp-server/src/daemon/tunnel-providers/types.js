// Tunnel provider type declarations (JSDoc)
// Ported from VSCode-Perplexity-MCP tunnel-providers/types.ts
// Adaptations: authtoken and domain added to TunnelProviderStartOptions (D-02 — ngrok authtoken from SecretStorage)

/**
 * @typedef {'cf-quick' | 'ngrok' | 'cf-named'} TunnelProviderId
 */

/**
 * @typedef {Object} SetupCheckAction
 * @property {string} label
 * @property {'open-url' | 'input-authtoken' | 'install-binary' | 'run-command'} kind
 * @property {string} [url]
 * @property {string} [command] - Opaque identifier for the command to run (used with kind: "run-command").
 */

/**
 * @typedef {Object} SetupCheck
 * @property {boolean} ready
 * @property {string} [reason] - User-facing reason the provider isn't ready (e.g. "ngrok authtoken not set").
 * @property {SetupCheckAction} [action] - Optional action hint the dashboard can surface.
 */

/**
 * @typedef {Object} TunnelProviderStartOptions
 * @property {number} port
 * @property {string} configDir
 * @property {(state: import('../tunnel.js').TunnelState) => void} onStateChange
 * @property {string} [authtoken] - Airtable addition: ngrok authtoken from VS Code SecretStorage (D-02)
 * @property {string} [domain]   - Airtable addition: ngrok reserved domain
 */

/**
 * @typedef {Object} TunnelProvider
 * @property {TunnelProviderId} id
 * @property {string} displayName
 * @property {string} description
 * @property {(configDir: string) => Promise<SetupCheck>} isSetupComplete
 * @property {(options: TunnelProviderStartOptions) => Promise<import('../tunnel.js').StartedTunnel>} start
 */

/**
 * @typedef {Object} TunnelProviderStatus
 * @property {TunnelProviderId} id
 * @property {string} displayName
 * @property {string} description
 * @property {SetupCheck} setup
 * @property {boolean} isActive
 */
