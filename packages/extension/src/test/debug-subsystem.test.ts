import { describe, it, expect } from 'vitest';
import { DebugCollector, type DebugEvent } from '../debug/collector.js';
import { parseStderrLine } from '../debug/stderr-parser.js';

// Vitest can't easily exercise `exporter.ts` because it depends on vscode APIs.
// Instead, the exporter is indirectly exercised through integration tests; here
// we cover the exposed primitives (collector + parser) that the round-3 fixes
// touched.

// ─── DebugCollector — dedup, resize, session export ─────────────────────────
describe('DebugCollector', () => {
  const mkEvent = (overrides: Partial<DebugEvent> = {}): DebugEvent => ({
    ts: new Date().toISOString(),
    source: 'ext',
    category: 'command',
    event: 'command:execute',
    data: {},
    ...overrides,
  });

  it('collapses consecutive identical events via `repeated` counter', () => {
    const c = new DebugCollector(100, true);
    c.push(mkEvent({ data: { tool: 'foo' } }));
    c.push(mkEvent({ data: { tool: 'foo' } }));
    c.push(mkEvent({ data: { tool: 'foo' } }));
    const { events } = c.export(false);
    expect(events.length).toBe(1);
    expect(events[0].repeated).toBe(3);
  });

  it('does not dedup events with different tool data', () => {
    const c = new DebugCollector(100, true);
    c.push(mkEvent({ data: { tool: 'foo' } }));
    c.push(mkEvent({ data: { tool: 'bar' } }));
    const { events } = c.export(false);
    expect(events.length).toBe(2);
  });

  it('drops events when disabled', () => {
    const c = new DebugCollector(100, false);
    c.push(mkEvent());
    expect(c.export(false).events.length).toBe(0);
    c.enabled = true;
    c.push(mkEvent());
    expect(c.export(false).events.length).toBe(1);
  });

  it('preserves events across resize() when shrinking within capacity', () => {
    const c = new DebugCollector(10, true);
    for (let i = 0; i < 5; i++) c.push(mkEvent({ event: `evt-${i}` }));
    c.resize(20);
    const { events } = c.export(false);
    expect(events.length).toBe(5);
    expect(events.map(e => e.event)).toEqual(['evt-0', 'evt-1', 'evt-2', 'evt-3', 'evt-4']);
  });

  it('keeps the newest N events when resize() shrinks below current size', () => {
    const c = new DebugCollector(10, true);
    for (let i = 0; i < 8; i++) c.push(mkEvent({ event: `evt-${i}` }));
    c.resize(3);
    const { events } = c.export(false);
    expect(events.map(e => e.event)).toEqual(['evt-5', 'evt-6', 'evt-7']);
  });

  it('startSession / stopSession returns timestamps', () => {
    const c = new DebugCollector(100, true);
    expect(c.isSessionActive).toBe(false);
    c.startSession();
    expect(c.isSessionActive).toBe(true);
    const s = c.stopSession();
    expect(s?.start).toBeDefined();
    expect(s?.end).toBeDefined();
  });

  it('session-only export only returns events captured after startSession', () => {
    const c = new DebugCollector(100, true);
    c.push(mkEvent({ event: 'before' }));
    c.startSession();
    c.push(mkEvent({ event: 'during' }));
    expect(c.export(true).events.map(e => e.event)).toEqual(['during']);
    expect(c.export(false).events.map(e => e.event)).toEqual(['before', 'during']);
  });
});

// ─── stderr-parser — H8 line-size cap ───────────────────────────────────────
describe('stderr-parser (H8)', () => {
  it('still consumes oversized debug lines but does not push them to the collector', () => {
    const c = new DebugCollector(100, true);
    // 128 KB > the 64 KB cap
    const huge = '[DEBUG]' + '{"ts":"x","source":"mcp","category":"tool","event":"x","data":{"x":"' + 'A'.repeat(128 * 1024) + '"}}';
    const consumed = parseStderrLine(huge, c);
    // Line is still consumed (it IS a debug line) but parsing is skipped.
    expect(consumed).toBe(true);
    // Must not have reached the collector because the line was oversized.
    expect(c.export(false).events.length).toBe(0);
  });

  it('passes reasonable-sized lines through to the collector', () => {
    const c = new DebugCollector(100, true);
    const line = '[DEBUG]{"ts":"2026-04-23T00:00:00Z","source":"mcp","category":"tool","event":"tool:call","data":{"tool":"foo"}}';
    expect(parseStderrLine(line, c)).toBe(true);
    const { events } = c.export(false);
    expect(events.length).toBe(1);
    expect(events[0].event).toBe('tool:call');
  });

  it('returns false for non-debug lines so callers can surface them as-is', () => {
    const c = new DebugCollector(100, true);
    expect(parseStderrLine('just a regular log line', c)).toBe(false);
    expect(c.export(false).events.length).toBe(0);
  });
});
