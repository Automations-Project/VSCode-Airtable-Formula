import { describe, it, expect } from 'vitest';
import { friendlyError } from '../lib/friendlyError';

// The exact shape of the raw error the MCP health-check emits when a SECOND
// Chrome tries to open the already-in-use persistent profile (exit code 21).
// Note it contains the Chrome flag `--disable-background-networking`, which is
// what historically tripped the greedy /network/i rule into a bogus
// "Network error — check your VPN" message.
const PROFILE_IN_USE_RAW =
  'browserType.launchPersistentContext: Target page, context or browser has been closed\n' +
  'Browser logs:\n\n<launching> C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe ' +
  '--disable-background-networking --disable-background-timer-throttling ' +
  '--user-data-dir=C:\\Users\\admin\\.airtable-user-mcp\\.chrome-profile --remote-debugging-pipe about:blank\n' +
  '<launched> pid=43736\n  - [pid=43736] <process did exit: exitCode=21, signal=null>\n';

describe('friendlyError — browser-profile contention is not a network error', () => {
  it('classifies the exit-21 launchPersistentContext failure as a profile-in-use error', () => {
    const result = friendlyError(PROFILE_IN_USE_RAW);
    expect(result).not.toBeNull();
    expect(result!.message).toMatch(/profile/i);
    expect(result!.message).not.toBe('Network error while contacting the service.');
  });

  it('does not treat the bare Chrome flag --disable-background-networking as a network error', () => {
    const result = friendlyError('chrome launched with --disable-background-networking and exited');
    expect(result!.message).not.toBe('Network error while contacting the service.');
  });
});

describe('friendlyError — genuine network failures still map to the network message', () => {
  it('maps an ECONNREFUSED errno to the network message', () => {
    const result = friendlyError('connect ECONNREFUSED 127.0.0.1:443');
    expect(result!.message).toBe('Network error while contacting the service.');
  });

  it('maps a Chromium net::ERR_* navigation failure to the network message', () => {
    const result = friendlyError('page.goto: net::ERR_NAME_NOT_RESOLVED at https://airtable.com/');
    expect(result!.message).toBe('Network error while contacting the service.');
  });

  it('maps an undici "fetch failed" to the network message', () => {
    const result = friendlyError('TypeError: fetch failed');
    expect(result!.message).toBe('Network error while contacting the service.');
  });
});

describe('friendlyError — unrelated classifications are unchanged', () => {
  it('still maps a 401 to the authentication message', () => {
    const result = friendlyError('Request failed with status 401 Unauthorized');
    expect(result!.message).toBe('Authentication was rejected.');
  });
});
