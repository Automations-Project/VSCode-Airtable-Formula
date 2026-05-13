import { describe, it, expect } from 'vitest';
import { automationCompletions } from '../../engines/automation/index.js';
import { LsCompletionItemKind } from '../../index.js';

describe('automationCompletions — top-level globals', () => {
  const items = automationCompletions('', { line: 0, character: 0 });

  it('returns exactly 5 top-level globals', () => {
    expect(items).toHaveLength(5);
  });

  it('includes base, table, input, output, fetch as labels', () => {
    const labels = items.map(i => i.label);
    for (const name of ['base', 'table', 'input', 'output', 'fetch']) {
      expect(labels).toContain(name);
    }
  });

  it('does NOT include cursor, session, or remoteFetchAsync', () => {
    const labels = items.map(i => i.label);
    expect(labels).not.toContain('cursor');
    expect(labels).not.toContain('session');
    expect(labels).not.toContain('remoteFetchAsync');
  });

  it('top-level items have kind Variable (5)', () => {
    const item = items.find(i => i.label === 'base');
    expect(item).toBeDefined();
    expect(item!.kind).toBe(LsCompletionItemKind.Variable);
  });

  it('top-level items have insertText equal to their label', () => {
    const item = items.find(i => i.label === 'base');
    expect(item!.insertText).toBe('base');
  });
});

describe('automationCompletions — dot-triggered method completions', () => {
  it('input. returns exactly 1 item: config', () => {
    const items = automationCompletions('input.', { line: 0, character: 6 });
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('config');
    expect(items[0].kind).toBe(LsCompletionItemKind.Method);
  });

  it('output. returns exactly 1 item: set', () => {
    const items = automationCompletions('output.', { line: 0, character: 7 });
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('set');
    expect(items[0].kind).toBe(LsCompletionItemKind.Method);
  });

  it('fetch. returns empty array (fetch has no methods)', () => {
    const items = automationCompletions('fetch.', { line: 0, character: 6 });
    expect(items).toHaveLength(0);
  });

  it('base. returns getTables with kind Method', () => {
    const items = automationCompletions('base.', { line: 0, character: 5 });
    const item = items.find(i => i.label === 'getTables');
    expect(item).toBeDefined();
    expect(item!.kind).toBe(LsCompletionItemKind.Method);
  });

  it('table. returns selectRecordsAsync', () => {
    const items = automationCompletions('table.', { line: 0, character: 6 });
    expect(items.find(i => i.label === 'selectRecordsAsync')).toBeDefined();
  });

  it('method items have insertText ending in ($0)', () => {
    const items = automationCompletions('base.', { line: 0, character: 5 });
    const item = items.find(i => i.label === 'getTables');
    expect(item!.insertText).toMatch(/\(\$0\)$/);
  });

  it('unknown object. returns empty array', () => {
    const items = automationCompletions('myLib.', { line: 0, character: 6 });
    expect(items).toHaveLength(0);
  });
});
