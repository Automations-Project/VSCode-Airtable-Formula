import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const execFile = promisify(execFileCallback);

/**
 * cloudflared auto-loads ~/.cloudflared/config.yml if present. A pre-existing
 * config (e.g. from another named tunnel) can inject ingress rules that
 * hijack our Quick Tunnel and return http_status:404 for every subdomain.
 * Writing a neutral config next to the binary and passing it via --config
 * prevents cloudflared from reading the user's config.yml.
 */
const NEUTRAL_CONFIG_FILENAME = "quick-tunnel.yml";
const NEUTRAL_CONFIG_BODY = "# airtable-user-mcp Quick Tunnel — routing handled by --url flag.\nno-autoupdate: true\n";

function ensureNeutralConfig(binaryPath) {
  try {
    const configPath = join(dirname(binaryPath), NEUTRAL_CONFIG_FILENAME);
    if (!existsSync(configPath)) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, NEUTRAL_CONFIG_BODY, { encoding: "utf8" });
    }
    return configPath;
  } catch {
    // Binary may live in a read-only path (e.g. test fixture using node.exe
    // from Program Files). Fall back to spawning without --config; cloudflared
    // may load the user's default config but that's still better than
    // refusing to start.
    return null;
  }
}

export function startTunnel(options) {
  const neutralConfigPath = ensureNeutralConfig(options.command);
  const spawnArgs = [
    ...(options.args ?? []),
    "tunnel",
    "--no-autoupdate",
    ...(neutralConfigPath ? ["--config", neutralConfigPath] : []),
    "--url", `http://127.0.0.1:${options.port}`,
  ];
  const child = spawn(
    options.command,
    spawnArgs,
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      windowsHide: true,
      env: options.env,
    },
  );

  let stopping = false;
  let settled = false;
  let resolveExited;
  const exited = new Promise((resolve) => {
    resolveExited = resolve;
  });
  let state = {
    status: "starting",
    url: null,
    pid: child.pid ?? null,
    error: null,
  };

  const updateState = (next) => {
    state = next;
    options.onStateChange?.(state);
  };

  updateState(state);

  let resolveReady;
  let rejectReady;
  const waitUntilReady = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const handleLine = (line) => {
    const url = extractTunnelUrl(line);
    if (!url || settled) {
      return;
    }
    settled = true;
    updateState({
      status: "enabled",
      url,
      pid: child.pid ?? null,
      error: null,
    });
    resolveReady(url);
  };

  createInterface({ input: child.stderr }).on("line", handleLine);
  createInterface({ input: child.stdout }).on("line", handleLine);

  child.on("error", (error) => {
    if (!settled) {
      settled = true;
      rejectReady(error);
    }
    updateState({
      status: stopping ? "disabled" : "crashed",
      url: null,
      pid: child.pid ?? null,
      error: error.message,
    });
  });

  child.on("exit", (code, signal) => {
    if (!settled) {
      settled = true;
      rejectReady(new Error(`cloudflared exited before publishing a tunnel URL (code=${code ?? "null"} signal=${signal ?? "null"}).`));
    }
    updateState({
      status: stopping ? "disabled" : "crashed",
      url: stopping ? null : state.url,
      pid: null,
      error: stopping ? null : `cloudflared exited (code=${code ?? "null"} signal=${signal ?? "null"}).`,
    });
    resolveExited();
  });

  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;

    if (child.exitCode !== null || child.killed) {
      updateState({
        status: "disabled",
        url: null,
        pid: null,
        error: null,
      });
      return;
    }

    if (process.platform === "win32") {
      await execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      }).catch(() => undefined);
      await exited;
      return;
    }

    child.kill("SIGTERM");
    await exited;
  };

  return {
    pid: child.pid ?? 0,
    waitUntilReady,
    stop,
    getState: () => state,
  };
}

export function extractTunnelUrl(line) {
  const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu);
  return match?.[0] ?? null;
}
