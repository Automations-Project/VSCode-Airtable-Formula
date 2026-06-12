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
    test: /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network/i,
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
    test: /exit code 21|launchPersistentContext|Target page, context or browser has been closed/i,
    message: 'The browser could not start (its profile may be locked).',
    hint: 'Close any leftover Chrome windows from a previous login and retry.',
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
