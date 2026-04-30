import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// trace() reads AIRTABLE_DEBUG at import time, so enable before dynamic import.
process.env.AIRTABLE_DEBUG = '1';
process.env.AIRTABLE_DEBUG_VERBOSE = '1';

const { trace } = await import('../src/debug-tracer.js');

/**
 * The debug tracer writes JSON lines prefixed with '[DEBUG]' to stderr.
 * These tests swap process.stderr.write temporarily and capture what's written.
 */
function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  const captured = [];
  process.stderr.write = (chunk) => {
    captured.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return captured.join('');
}

function parseDebugLine(line) {
  if (!line.startsWith('[DEBUG]')) return null;
  return JSON.parse(line.slice('[DEBUG]'.length));
}

describe('debug-tracer redaction', () => {
  it('redacts sensitive keys in data', () => {
    const out = captureStderr(() => {
      trace('tool', 'tool:call', {
        tool: 'my_tool',
        password: 'hunter2',
        authorization: 'Bearer abc123',
        secretSocketId: 'sockXXX',
        innocent: 'visible',
      });
    });
    const entry = parseDebugLine(out.trim());
    assert.ok(entry, 'should emit a [DEBUG] line');
    assert.equal(entry.data.password, '[REDACTED]');
    assert.equal(entry.data.authorization, '[REDACTED]');
    assert.equal(entry.data.secretSocketId, '[REDACTED]');
    assert.equal(entry.data.innocent, 'visible');
  });

  it('redacts nested objects', () => {
    const out = captureStderr(() => {
      trace('auth', 'auth:event', {
        config: {
          nested: { password: 'topsecret', token: 'abc' },
        },
      });
    });
    const entry = parseDebugLine(out.trim());
    assert.equal(entry.data.config.nested.password, '[REDACTED]');
    assert.equal(entry.data.config.nested.token, '[REDACTED]');
  });

  it('redacts Bearer-prefixed string values', () => {
    const out = captureStderr(() => {
      trace('http', 'http:request', { headerValue: 'Bearer eyJabc123.xyz' });
    });
    const entry = parseDebugLine(out.trim());
    assert.equal(entry.data.headerValue, '[REDACTED]');
  });
});

describe('debug-tracer safeStringify / circular refs', () => {
  it('does not crash on circular objects', () => {
    const a = { name: 'a' };
    const b = { name: 'b', a };
    a.b = b; // circular

    const out = captureStderr(() => {
      trace('tool', 'tool:call', { tool: 'circ_test', value: a });
    });
    // Must have emitted something
    assert.ok(out.includes('[DEBUG]'));
    const entry = parseDebugLine(out.trim());
    assert.ok(entry, 'entry should parse');
    // Deep equality isn't meaningful for circular — we just verify no crash.
  });

  it('emits a breadcrumb when data is fundamentally un-serializable', () => {
    // A BigInt inside a Proxy that throws on any access — this forces even the
    // safeStringify replacer to fail, exercising the minimal fallback path.
    const hostile = new Proxy({}, {
      get() { throw new Error('nope'); },
      has() { throw new Error('nope'); },
      ownKeys() { throw new Error('nope'); },
      getOwnPropertyDescriptor() { throw new Error('nope'); },
    });

    const out = captureStderr(() => {
      trace('tool', 'tool:call', { tool: 'hostile', payload: hostile });
    });
    // Either safeStringify produced something, or the breadcrumb fallback did.
    // Either way a [DEBUG] line must appear.
    assert.ok(out.includes('[DEBUG]'), 'breadcrumb fallback must still emit');
  });
});

describe('debug-tracer error scrubbing', () => {
  it('scrubs secrets from the error field', () => {
    const out = captureStderr(() => {
      trace('tool', 'tool:error', { tool: 'x' }, 'failed: Bearer eyJabc123 and password=hunter2');
    });
    const entry = parseDebugLine(out.trim());
    assert.ok(entry, 'entry should parse');
    assert.ok(!entry.error.includes('eyJabc123'), `error should not leak bearer token, got: ${entry.error}`);
    assert.ok(!entry.error.includes('hunter2'), `error should not leak password, got: ${entry.error}`);
    assert.ok(entry.error.includes('[REDACTED]'), `error should mark redaction, got: ${entry.error}`);
  });
});
