/**
 * Corporate-proxy support for the direct-HTTP transport.
 *
 * Node's global `fetch` (undici) deliberately ignores `HTTP_PROXY` /
 * `HTTPS_PROXY` — unlike curl, git, or Chrome. Since all Airtable API traffic
 * moved off the browser page and onto `fetch` (src/http-transport.js), a user
 * behind a mandatory corporate proxy got a uniquely confusing failure: the
 * browser login succeeded (Chrome uses the OS proxy), so the dashboard could
 * report a healthy session while every tool call died with a bare
 * "fetch failed" that the auth layer then reported as `SESSION_INVALID`.
 *
 * Node ≥24 can opt in with `NODE_USE_ENV_PROXY=1`; we target Node ≥22, so we
 * wire undici's `EnvHttpProxyAgent` ourselves. That agent implements the whole
 * env contract — `HTTP_PROXY` for http origins, `HTTPS_PROXY` for https
 * origins, and `NO_PROXY` bypass matching — so we only decide *whether* to
 * build one, never which host to route where.
 *
 * `undici` is an OPTIONAL dependency, lazy-loaded like patchright/otpauth/impit:
 * if it is unavailable we fall back to today's un-proxied behaviour and say so
 * once, rather than breaking startup for the 99% who have no proxy at all.
 *
 * TLS interception is a separate axis and is NOT solved here: a proxy that
 * re-signs HTTPS with a private root still needs that root in Node's trust
 * store, i.e. `NODE_EXTRA_CA_CERTS=/path/to/corp-root.pem`. The extension
 * spawns the daemon with `{...process.env}`, so setting it in the environment
 * that launches VS Code is enough. `describeFetchError` below turns the
 * resulting certificate errors into that advice instead of "fetch failed".
 */

// Only the variables undici's EnvHttpProxyAgent actually consumes. ALL_PROXY is
// handled separately: it is NOT part of that contract, and silently treating it
// as configured would claim proxy support we do not deliver.
const PROXY_VARS = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY'];
const ALL_PROXY_VARS = ['all_proxy', 'ALL_PROXY'];

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** Names of the proxy env vars that are set (and non-empty), in precedence order. */
export function proxyEnvVars(env = process.env) {
  return PROXY_VARS.filter((name) => nonEmpty(env[name]));
}

/** True when the environment asks for a proxy that we can actually honour. */
export function proxyConfigured(env = process.env) {
  return proxyEnvVars(env).length > 0;
}

/**
 * Cache identity for the dispatcher: the proxy/no-proxy env values it was built
 * from. EnvHttpProxyAgent snapshots process.env at construction, so a changed
 * env must produce a new agent rather than silently reuse a stale one.
 */
function cacheKey(env) {
  return [...PROXY_VARS, 'no_proxy', 'NO_PROXY']
    .map((name) => `${name}=${env[name] ?? ''}`)
    .join('|');
}

let _cache = null;      // { key, promise } — the PROMISE, so concurrent callers single-flight
let _warnedMissing = false;
let _warnedAllProxy = false;

/**
 * The dispatcher to hand to `fetch` for proxied environments, or `null` when no
 * proxy is configured (or undici is unavailable) — in which case callers must
 * behave exactly as before.
 *
 * @param {object}   [opts]
 * @param {object}   [opts.env]              env to read (test seam)
 * @param {Function} [opts.agentFactory]     async () => dispatcher (test seam)
 * @returns {Promise<object|null>}
 */
export async function getProxyDispatcher({ env = process.env, agentFactory } = {}) {
  if (!proxyConfigured(env)) {
    if (!_warnedAllProxy && ALL_PROXY_VARS.some((n) => nonEmpty(env[n]))) {
      _warnedAllProxy = true;
      console.error(
        '[proxy] ALL_PROXY is set but is not part of the Node proxy env contract — ' +
        'set HTTPS_PROXY (and NO_PROXY) instead so Airtable API calls are routed through your proxy.',
      );
    }
    return null;
  }

  const key = cacheKey(env);
  if (_cache && _cache.key === key) return _cache.promise;

  // Memoize the PROMISE (assigned before the first await) so two concurrent
  // callers single-flight onto one agent instead of each building one and
  // orphaning the loser's socket pool. It resolves to null on failure and never
  // rejects, so a cached failure degrades to "direct" for every caller.
  const pending = (async () => {
    try {
      if (agentFactory) return await agentFactory();
      const mod = await import('undici');
      const EnvHttpProxyAgent = mod.EnvHttpProxyAgent || mod.default?.EnvHttpProxyAgent;
      if (!EnvHttpProxyAgent) throw new Error('the installed `undici` has no EnvHttpProxyAgent (needs undici ≥ 6.19)');
      const agent = new EnvHttpProxyAgent();
      console.error(`[proxy] routing Airtable API calls through ${proxyEnvVars(env).join(', ')} (NO_PROXY honoured).`);
      return agent;
    } catch (err) {
      if (!_warnedMissing) {
        _warnedMissing = true;
        console.error(
          `[proxy] ${proxyEnvVars(env).join(', ')} is set but the proxy agent could not be created (${err.message}). ` +
          'API calls will be attempted DIRECTLY and will fail if your network requires the proxy. ' +
          'Install the optional `undici` dependency to enable proxy support.',
        );
      }
      return null;
    }
  })();

  // A superseded agent is deliberately NOT closed here: an in-flight request may
  // still be using it, and the daemon's environment is fixed at spawn time, so
  // this only ever fires in tests (which call resetProxyDispatcher explicitly).
  _cache = { key, promise: pending };
  return pending;
}

/** Drop the memoized dispatcher (tests; also lets a changed env take effect). */
export function resetProxyDispatcher() {
  const previous = _cache?.promise;
  _cache = null;
  _warnedMissing = false;
  _warnedAllProxy = false;
  // Best-effort: release the agent's sockets. Never throws, never rejects.
  void Promise.resolve(previous)
    .then((agent) => agent?.close?.())
    .catch(() => {});
}

/**
 * Turn a thrown fetch error into something a user can act on.
 *
 * undici collapses every network/TLS failure into the message "fetch failed"
 * and hides the real reason in `err.cause`. Surfacing the cause chain is what
 * makes a proxy/CA misconfiguration diagnosable instead of being reported by
 * the auth layer as an expired Airtable login.
 */
export function describeFetchError(err, { env = process.env } = {}) {
  const parts = [];
  const base = err?.message ? String(err.message) : String(err);
  parts.push(base);

  const codes = [];
  let cause = err?.cause;
  for (let depth = 0; cause && depth < 3; depth++) {
    const code = cause.code ? String(cause.code) : '';
    const message = cause.message ? String(cause.message) : '';
    const detail = [code, message].filter(Boolean).join(': ');
    if (detail && !base.includes(detail)) parts.push(detail);
    if (code) codes.push(code);
    cause = cause.cause;
  }

  const all = codes.join(' ');
  if (/CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ALTNAME/i.test(all)) {
    parts.push(
      'TLS certificate rejected — a TLS-inspecting proxy or private CA is likely re-signing HTTPS. ' +
      'Point NODE_EXTRA_CA_CERTS at your organisation\'s root certificate (PEM) in the environment that ' +
      'starts VS Code / the daemon, then restart it.',
    );
  } else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET/i.test(all) && !proxyConfigured(env)) {
    parts.push(
      'No HTTPS_PROXY is configured — if this machine reaches the internet only through a corporate ' +
      'proxy, set HTTPS_PROXY (and NO_PROXY) in the environment that starts VS Code / the daemon.',
    );
  }

  return parts.join(' — ');
}
