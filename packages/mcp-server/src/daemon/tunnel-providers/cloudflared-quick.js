/**
 * Cloudflare Quick Tunnel provider — wraps the existing binary-based flow.
 *
 * Ephemeral subdomain on *.trycloudflare.com. Zero configuration required
 * beyond installing the binary (handled via `daemon install-tunnel`).
 *
 * Ported from VSCode-Perplexity-MCP tunnel-providers/cloudflared-quick.ts
 * Adaptation: tool name replaced with "airtable-user-mcp" in all error messages
 */

import { existsSync } from "node:fs";
import { startTunnel } from "../tunnel.js";
import { getTunnelBinaryPath } from "../install-tunnel.js";

export const cloudflaredQuickProvider = {
  id: "cf-quick",
  displayName: "Cloudflare Quick Tunnel",
  description: "Zero-setup ephemeral *.trycloudflare.com URL. Changes on every restart.",

  async isSetupComplete(configDir) {
    const binaryPath = getTunnelBinaryPath(configDir);
    if (!existsSync(binaryPath)) {
      return {
        ready: false,
        reason: "cloudflared binary not installed.",
        action: { label: "Install cloudflared", kind: "install-binary" },
      };
    }
    return { ready: true };
  },

  async start(options) {
    const binaryPath = getTunnelBinaryPath(options.configDir);
    if (!existsSync(binaryPath)) {
      throw new Error(
        "cloudflared is not installed. Run `npx airtable-user-mcp daemon install-tunnel` first.",
      );
    }
    return startTunnel({
      command: binaryPath,
      port: options.port,
      onStateChange: options.onStateChange,
    });
  },
};
