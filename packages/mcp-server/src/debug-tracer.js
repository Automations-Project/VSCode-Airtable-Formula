const enabled = process.env.AIRTABLE_DEBUG === '1';
const verbose = process.env.AIRTABLE_DEBUG_VERBOSE === '1';

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

  const entry = {
    ts: new Date().toISOString(),
    source: 'mcp',
    category,
    event,
    data,
  };
  if (error !== undefined) entry.error = error;

  try {
    process.stderr.write('[DEBUG]' + JSON.stringify(entry) + '\n');
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
