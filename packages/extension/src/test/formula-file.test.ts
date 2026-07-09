import { describe, it, expect, vi } from 'vitest';

// Mock vscode before importing modules that depend on it
vi.mock('vscode', () => ({
  window: {},
  workspace: {},
  ProgressLocation: { Notification: 15 },
}));

import { parseMcpEnvelope } from '../commands/formulaFile.js';

// Regression tests for the 2026-07-09 daemon 406 bug (Bug 2): the daemon may answer
// a tools/call POST as plain JSON (enableJsonResponse) or as an SSE stream (older
// daemons) — parseMcpEnvelope must handle both.

describe('parseMcpEnvelope', () => {
  const rpcResponse = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{}' }] } };

  it('parses a plain application/json body', () => {
    expect(parseMcpEnvelope(JSON.stringify(rpcResponse), 'application/json')).toEqual(rpcResponse);
  });

  it('parses an SSE body, picking the data line that carries an id', () => {
    const sse = [
      'event: message',
      `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}`,
      '',
      'event: message',
      `data: ${JSON.stringify(rpcResponse)}`,
      '',
    ].join('\n');
    expect(parseMcpEnvelope(sse, 'text/event-stream')).toEqual(rpcResponse);
  });

  it('handles CRLF line endings in SSE bodies', () => {
    const sse = `event: message\r\ndata: ${JSON.stringify(rpcResponse)}\r\n\r\n`;
    expect(parseMcpEnvelope(sse, 'text/event-stream; charset=utf-8')).toEqual(rpcResponse);
  });

  it('throws when an SSE stream contains no JSON-RPC response', () => {
    expect(() => parseMcpEnvelope('event: message\ndata: not-json\n\n', 'text/event-stream')).toThrow(
      /No JSON-RPC response/,
    );
  });
});
