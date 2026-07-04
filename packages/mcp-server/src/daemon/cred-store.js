/**
 * In-memory injected credential store (SECURITY-CRITICAL).
 *
 * Holds live Airtable credentials — a session cookie (+CSRF) for `byo`, or
 * email/password/TOTP-secret for `direct-login` — delivered to the shared
 * daemon AT RUNTIME over the bearer-authenticated POST /daemon/auth-credentials
 * endpoint (src/daemon/server.js).
 *
 * These credentials live in THIS PROCESS'S MEMORY ONLY. They are:
 *   - NEVER written to disk (no file, no lockfile, no settings).
 *   - NEVER logged (not by the debug-tracer, not to stdout/stderr).
 *   - Gone when the process exits, or when clearInjectedCredentials() is called.
 *
 * The daemon deliberately does NOT receive credentials in its environment (env
 * is inheritable/inspectable), so this in-memory channel is how it gets them.
 * Loaders (byo-credentials, direct-login) read this store FIRST, then fall back
 * to env, then file — so with an empty store, behavior is unchanged.
 *
 * Keep this module tiny and dependency-free. Do NOT add persistence or logging.
 *
 * @typedef {Object} InjectedCredentials
 * @property {'byo'|'direct-login'} [authMode]
 * @property {string} [cookie]
 * @property {string} [csrf]
 * @property {string} [email]
 * @property {string} [password]
 * @property {string} [totpSecret]
 */

/** @type {InjectedCredentials | null} */
let injected = null;

/**
 * Store the injected credentials, replacing any previous set. A shallow copy is
 * kept so a later mutation of the caller's object can't reach into the store
 * (all fields are primitive strings, so shallow is sufficient). Passing null /
 * undefined / a non-object clears the store.
 *
 * @param {InjectedCredentials | null | undefined} creds
 */
export function setInjectedCredentials(creds) {
  if (!creds || typeof creds !== 'object') {
    injected = null;
    return;
  }
  injected = { ...creds };
}

/**
 * @returns {InjectedCredentials | null} a fresh shallow copy of the stored
 *   credentials (mutating the returned object never corrupts the store), or
 *   null when nothing is injected.
 */
export function getInjectedCredentials() {
  return injected ? { ...injected } : null;
}

/** Drop the injected credentials from memory. */
export function clearInjectedCredentials() {
  injected = null;
}
