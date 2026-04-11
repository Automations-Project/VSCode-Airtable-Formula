import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Result of probing the system for a Chromium-based browser usable by Patchright.
 *
 * The MCP auth stack launches Patchright with `channel: 'chrome'`, which means
 * it shells out to a real system Chrome install — Playwright-style bundled
 * Chromium is intentionally NOT shipped in this extension. If no usable
 * browser is found, login and health checks will fail with an opaque Patchright
 * error, so we do this detection up front and surface an actionable message.
 */
export interface BrowserProbe {
  /** True if any supported Chromium-based browser was found. */
  found: boolean;
  /** The channel name to pass to Patchright's launchPersistentContext. */
  channel?: 'chrome' | 'msedge' | 'chromium';
  /** Absolute path to the executable we detected. */
  executablePath?: string;
  /** Human-readable name for UI display. */
  label?: string;
  /**
   * True when this probe resolved to a bundled Chromium we downloaded into
   * globalStorage rather than a system-installed browser.
   */
  downloaded?: boolean;
}

function existsSafe(p: string | undefined): boolean {
  if (!p) return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Probe for Google Chrome (preferred) across Windows, macOS, and Linux.
 */
function probeChrome(): string | undefined {
  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === 'win32') {
    const programFiles   = process.env['ProgramFiles']       || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData   = process.env['LOCALAPPDATA']       || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(
      path.join(programFiles,    'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData,    'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    );
  } else {
    // linux, freebsd, etc.
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/local/bin/google-chrome',
      '/snap/bin/google-chrome',
      '/opt/google/chrome/chrome',
    );
  }

  return candidates.find(existsSafe);
}

/**
 * Probe for Microsoft Edge — a reasonable fallback because it is Chromium-
 * based, pre-installed on Windows 10/11, and Patchright supports it natively
 * via `channel: 'msedge'`. The Airtable login flow works in Edge because the
 * DOM and selectors are identical to Chrome.
 */
function probeEdge(): string | undefined {
  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === 'win32') {
    const programFiles    = process.env['ProgramFiles']       || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(programFiles,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    candidates.push(
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/opt/microsoft/msedge/msedge',
    );
  }

  return candidates.find(existsSafe);
}

/**
 * Probe for Chromium (the open-source browser, not Playwright's bundle).
 * Used on Linux distros where Chromium is the default.
 */
function probeChromium(): string | undefined {
  if (process.platform === 'win32') return undefined;
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  return candidates.find(existsSafe);
}

/**
 * Detect a usable Chromium-based browser in preferred order:
 *   1. Google Chrome        (what auth.js was written against)
 *   2. Microsoft Edge       (preinstalled on Windows, identical DOM)
 *   3. System Chromium      (Linux fallback)
 *   4. Downloaded Chromium  (bundled via patchright install — last resort)
 *
 * The downloaded path is passed in from {@link BrowserDownloadManager} so the
 * detector has no coupling to VS Code's ExtensionContext / file system layout.
 *
 * Result is NOT cached — callers should cache if they want, because the user
 * may install Chrome between calls.
 */
export function detectBrowser(downloadedPath?: string): BrowserProbe {
  const chrome = probeChrome();
  if (chrome) {
    return { found: true, channel: 'chrome', executablePath: chrome, label: 'Google Chrome' };
  }

  const edge = probeEdge();
  if (edge) {
    return { found: true, channel: 'msedge', executablePath: edge, label: 'Microsoft Edge' };
  }

  const chromium = probeChromium();
  if (chromium) {
    return { found: true, channel: 'chromium', executablePath: chromium, label: 'Chromium' };
  }

  if (downloadedPath && existsSafe(downloadedPath)) {
    return {
      found: true,
      channel: 'chromium',
      executablePath: downloadedPath,
      label: 'Bundled Chromium',
      downloaded: true,
    };
  }

  return { found: false };
}
