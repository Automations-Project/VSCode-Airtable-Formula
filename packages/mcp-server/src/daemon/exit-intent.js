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
 * ponytail: a module-global single slot, not a per-request map — an exit is
 * process-wide by definition and there is exactly one daemon per process, so
 * two concurrent stop requests collapsing into one exit is the correct outcome.
 */

/** @typedef {{ action: 'stop'|'restart', by?: string, reason?: string|null }} DaemonExitIntent */

/** @type {DaemonExitIntent|null} */
let pending = null;

/** @param {DaemonExitIntent} intent */
export function requestDaemonExit(intent) {
  pending = intent;
}

/** Read-and-clear. @returns {DaemonExitIntent|null} */
export function takeDaemonExit() {
  const intent = pending;
  pending = null;
  return intent;
}

/** Non-consuming peek — for tests and for a handler that wants to report what it just staged. */
export function peekDaemonExit() {
  return pending;
}

/** Drop a staged intent (e.g. the action failed validation after staging). */
export function clearDaemonExit() {
  pending = null;
}
