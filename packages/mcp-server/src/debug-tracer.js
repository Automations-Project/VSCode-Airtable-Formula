const enabled = process.env.AIRTABLE_DEBUG === '1';
const verbose = process.env.AIRTABLE_DEBUG_VERBOSE === '1';

// ─── Redaction ───────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  '_csrf', 'csrf', 'csrfToken', 'secretSocketId',
  'cookie', 'cookies', 'set-cookie',
  'password', 'otpSecret', 'otpCode', 'totp',
  'AIRTABLE_PASSWORD', 'AIRTABLE_OTP_SECRET', 'AIRTABLE_EMAIL',
  'authorization', 'apiKey', 'api_key', 'token', 'accessToken',
  'refreshToken', 'bearer', 'secret', 'privateKey', 'private_key',
  'key', 'email', 'username',
]);

/** Recursively redact sensitive fields from a value. Cycle-safe. */
function redactValue(key, val, seen) {
  if (val === null || val === undefined) return val;
  if (SENSITIVE_KEYS.has(key)) return '[REDACTED]';

  if (typeof val === 'string') {
    // Redact values that look like cookies or authorization headers
    if (/^(Bearer\s|Basic\s|Session\s)/i.test(val)) return '[REDACTED]';
    return val;
  }

  if (typeof val !== 'object') return val;

  // Cycle detection — a self-referencing payload (e.g. a Proxy graph) would
  // otherwise recurse until the stack blows up.
  if (seen.has(val)) return '[Circular]';
  seen.add(val);

  try {
    if (Array.isArray(val)) {
      return val.map((item, i) => redactValue(String(i), item, seen));
    }
    const result = {};
    // Object.entries can throw on hostile Proxy traps; caller catches.
    for (const [k, v] of Object.entries(val)) {
      result[k] = redactValue(k, v, seen);
    }
    return result;
  } finally {
    // Remove from seen set so sibling branches aren't blocked by a shared
    // non-cyclic node higher up the tree.
    seen.delete(val);
  }
}

/** Return a copy of data with sensitive keys redacted. */
function redactData(data) {
  return redactValue('root', data, new WeakSet());
}

/**
 * JSON.stringify replacer that detects cycles and returns '[Circular]'.
 * Required because tool arguments coming from LLMs may contain self-referencing
 * structures (e.g., a Playwright locator proxy or a schema with backrefs).
 */
function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    // Node/Buffer/typed-array defensive: stringify opaque types as tags
    if (typeof v === 'bigint') return v.toString() + 'n';
    if (typeof v === 'function') return `[Function${v.name ? `:${v.name}` : ''}]`;
    if (typeof v === 'symbol') return v.toString();
    return v;
  });
}

/** Strip inline secret patterns from an error message or free-form string. */
const ERROR_SCRUBBERS = [
  /(secretSocketId[=:"\s]+)[A-Za-z0-9._-]+/gi,
  /(_csrf[=:"\s]+)[A-Za-z0-9._-]+/gi,
  /(csrfToken[=:"\s]+)[A-Za-z0-9._-]+/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /(authorization[=:"\s]+)[A-Za-z0-9._~+/=-]+/gi,
  /(password[=:"\s]+)\S+/gi,
];
function scrubErrorMessage(msg) {
  if (typeof msg !== 'string') return msg;
  let out = msg;
  for (const re of ERROR_SCRUBBERS) out = out.replace(re, '$1[REDACTED]');
  return out;
}

/**
 * Emit a structured debug event to stderr as a [DEBUG]-prefixed JSON line.
 * The extension's stderr parser picks these up and feeds them into the ring buffer.
 *
 * @param {'tool'|'auth'|'http'|'error'} category
 * @param {string} event - e.g. "tool:call", "auth:browser_launch"
 * @param {Record<string, unknown>} data
 * @param {string} [error] - error message if this event represents a failure
 */
export function trace(category, event, data = {}, error) {
  if (!enabled) return;
  if (category === 'http' && !verbose) return;

  const ts = new Date().toISOString();
  let line;
  try {
    // Redaction itself can throw (hostile Proxy traps), so it lives inside
    // the try — together with safeStringify, they form the "best-effort"
    // emit path.
    const entry = {
      ts, source: 'mcp', category, event,
      data: redactData(data),
    };
    if (error !== undefined) entry.error = scrubErrorMessage(error);
    line = '[DEBUG]' + safeStringify(entry) + '\n';
  } catch {
    // Last-resort fallback — emit a minimal breadcrumb so the debug stream
    // stays alive. This catches both redaction failures (hostile proxy) and
    // JSON.stringify failures (BigInt in exotic positions, etc.).
    try {
      line = '[DEBUG]' + JSON.stringify({
        ts, source: 'mcp', category, event,
        data: { _stringifyFailed: true },
      }) + '\n';
    } catch {
      return;
    }
  }
  try {
    process.stderr.write(line);
  } catch {
    // Never crash the server for debug output
  }
}

/**
 * Wrap an async function to emit tool:call / tool:result / tool:error events.
 * Returns a new function with the same signature.
 */
export function traceToolHandler(toolName, handler) {
  if (!enabled) return handler;

  return async (args) => {
    trace('tool', 'tool:call', { tool: toolName, args });
    const start = Date.now();
    try {
      const result = await handler(args);
      const duration_ms = Date.now() - start;
      const isError = result?.isError === true;
      const text = result?.content?.[0]?.text ?? '';
      if (isError) {
        trace('tool', 'tool:error', { tool: toolName, duration_ms }, text);
      } else {
        trace('tool', 'tool:result', {
          tool: toolName,
          duration_ms,
          truncated_response: text.length > 500 ? text.slice(0, 500) + '...[truncated]' : text,
        });
      }
      return result;
    } catch (err) {
      const duration_ms = Date.now() - start;
      trace('tool', 'tool:error', { tool: toolName, duration_ms }, err.message);
      throw err;
    }
  };
}
