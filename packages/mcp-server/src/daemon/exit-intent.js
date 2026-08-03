/**
 * One-slot handoff from a tool handler to the express /mcp route.
 *
 * A `manage_daemon` stop/restart arriving over /mcp CANNOT shut the process down
 * from inside the handler. Traced through the bundled SDK
 * (@modelcontextprotocol/sdk/dist/cjs/server/webStandardStreamableHttp.js):
 * with `enableJsonResponse`, `handlePostRequest` returns a Promise that is only
 * ever settled by `resolveJson`, which lives in `_streamMapping`. `close()`
 * runs each entry's `cleanup()` — which merely DELETES the map entry, never
 * calling `resolveJson` — then clears the map. The still-pending tool call then
 * returns, `send()` finds the request id in `_requestToStreamMapping` (close()
 * does not clear that one) but no stream, and throws
 * `No connection established for request ID: …`. The handleRequest promise stays
 * unsettled forever, `res` never ends, and `httpServer.close()` blocks on the
 * open socket. A `setTimeout` inside the handler is the same race with extra
 * steps: the handler has no signal that its JSON was flushed.
 *
 * So the handler only STATES the intent here; server.js consumes it from the
 * response's own 'finish' event, which fires strictly after the body is handed
 * to the OS. Express owns the exit, the handler owns the answer.
 *
 * The intent remains process-wide, but it carries the identity of the HTTP
 * request that staged it. Without that ownership, an unrelated response that
 * happened to finish first could consume the slot and begin shutdown before the
 * stop/restart caller received its confirmation.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** @typedef {{ action: 'stop'|'restart', by?: string, reason?: string|null }} DaemonExitIntent */

/** @typedef {{ intent: DaemonExitIntent, owner: symbol|null }} PendingDaemonExit */

const requestOwner = new AsyncLocalStorage();

/** @type {PendingDaemonExit|null} */
let pending = null;

/**
 * Associate any exit staged while `fn` runs with one /mcp response.
 * @template T
 * @param {symbol} owner
 * @param {() => T} fn
 * @returns {T}
 */
export function withDaemonExitOwner(owner, fn) {
  return requestOwner.run(owner, fn);
}

/** @param {DaemonExitIntent} intent */
export function requestDaemonExit(intent) {
  pending = { intent, owner: requestOwner.getStore() ?? null };
}

/**
 * Read-and-clear, optionally only when the caller owns the intent.
 * @param {symbol} [owner]
 * @returns {DaemonExitIntent|null}
 */
export function takeDaemonExit(owner) {
  if (!pending || (owner !== undefined && pending.owner !== owner)) return null;
  const { intent } = pending;
  pending = null;
  return intent;
}

/** Non-consuming peek — for tests and for a handler that wants to report what it just staged. */
export function peekDaemonExit() {
  return pending?.intent ?? null;
}

/** Drop a staged intent (e.g. the action failed validation after staging). */
export function clearDaemonExit() {
  pending = null;
}
