/**
 * Map raw error strings (Node errno codes, HTTP statuses, patchright
 * internals) to human-readable guidance. The raw text stays available for
 * tooltips / bug reports; users see what happened and what to do next.
 */
export interface FriendlyError {
  message: string;
  hint?: string;
  raw: string;
}

const PATTERNS: Array<{ test: RegExp; message: string; hint?: string }> = [
  {
    // Browser-profile contention (Chrome exit code 21) — a second Chrome tried
    // to open the shared persistent profile that another process already holds.
    // MUST precede the network rule: the raw Chrome launch log contains the
    // flag `--disable-background-networking`, which a bare /network/ match would
    // mis-classify as a connectivity problem and send the user chasing VPNs.
    test: /launchPersistentContext|exit ?code ?21|exitCode=21|Target page, context or browser has been closed|ProcessSingleton|user-data-dir/i,
    message: 'Another program is using the Airtable browser profile.',
    hint: 'Close other Airtable/MCP sessions (or wait a moment) and try again — the extension shares one browser profile.',
  },
  {
    // Genuine connectivity failures only: Node errno codes, undici "fetch
    // failed", and Chromium net:: navigation errors. A bare "network" was
    // removed because it false-matched Chrome command-line flags.
    test: /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|fetch failed|net::ERR|NetworkError/i,
    message: 'Network error while contacting the service.',
    hint: 'Check your internet connection (or proxy/VPN) and try again.',
  },
  {
    test: /401|Unauthorized/i,
    message: 'Authentication was rejected.',
    hint: 'Your Airtable session may have expired — try logging in again.',
  },
  {
    test: /403|Forbidden/i,
    message: 'Access denied by Airtable.',
    hint: 'Your account may lack permission for this base or action.',
  },
  {
    test: /429|rate.?limit/i,
    message: 'Airtable is rate-limiting requests.',
    hint: 'Wait a minute and try again.',
  },
  {
    test: /No supported browser|executable doesn't exist|chrome-missing/i,
    message: 'No usable browser was found.',
    hint: 'Install Google Chrome, or use "Download bundled Chromium" below.',
  },
  {
    test: /ENOENT/i,
    message: 'A required file or folder is missing.',
    hint: 'Try running Setup again to recreate the configuration.',
  },
  {
    test: /EACCES|EPERM/i,
    message: 'Permission denied while accessing a file.',
    hint: 'Another program may be locking it, or it needs elevated rights.',
  },
  {
    test: /ENOSPC/i,
    message: 'The disk is full.',
    hint: 'Free up disk space and retry.',
  },
  {
    test: /timed? ?out/i,
    message: 'The operation timed out.',
    hint: 'The service may be slow right now — try again.',
  },
];

export function friendlyError(raw: string | null | undefined): FriendlyError | null {
  if (!raw) return null;
  for (const p of PATTERNS) {
    if (p.test.test(raw)) return { message: p.message, hint: p.hint, raw };
  }
  // Unrecognized — show the raw text but keep it as the message so nothing is hidden.
  return { message: raw, raw };
}
