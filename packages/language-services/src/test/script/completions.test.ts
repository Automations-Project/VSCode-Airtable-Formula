import { describe, it, expect } from 'vitest';
import { scriptCompletions } from '../../engines/script/index.js';
import { LsCompletionItemKind } from '../../index.js';

describe('scriptCompletions — top-level globals', () => {
  const items = scriptCompletions('', { line: 0, character: 0 });

  it('includes all 8 globals as labels', () => {
    const labels = items.map(i => i.label);
    for (const name of ['base', 'table', 'cursor', 'input', 'output', 'session', 'fetch', 'remoteFetchAsync']) {
      expect(labels).toContain(name);
    }
  });

  it('base item has kind Variable (5)', () => {
    const item = items.find(i => i.label === 'base');
    expect(item).toBeDefined();
    expect(item!.kind).toBe(LsCompletionItemKind.Variable);
  });

  it('top-level items have insertText equal to their label', () => {
    const item = items.find(i => i.label === 'base');
    expect(item!.insertText).toBe('base');
  });
});

describe('scriptCompletions — dot-triggered method completions', () => {
  it('base. returns getTables with kind Method (1)', () => {
    const items = scriptCompletions('base.', { line: 0, character: 5 });
    const item = items.find(i => i.label === 'getTables');
    expect(item).toBeDefined();
    expect(item!.kind).toBe(LsCompletionItemKind.Method);
  });

  it('base. returns getTable method', () => {
    const items = scriptCompletions('base.', { line: 0, character: 5 });
    expect(items.find(i => i.label === 'getTable')).toBeDefined();
  });

  it('table. returns selectRecordsAsync', () => {
    const items = scriptCompletions('table.', { line: 0, character: 6 });
    const item = items.find(i => i.label === 'selectRecordsAsync');
    expect(item).toBeDefined();
    expect(item!.kind).toBe(LsCompletionItemKind.Method);
  });

  it('method items have insertText ending in ($0)', () => {
    const items = scriptCompletions('base.', { line: 0, character: 5 });
    const item = items.find(i => i.label === 'getTables');
    expect(item!.insertText).toMatch(/\(\$0\)$/);
  });

  it('unknown object. returns empty array', () => {
    const items = scriptCompletions('myLib.', { line: 0, character: 6 });
    expect(items).toHaveLength(0);
  });

  it('dot-triggered items have kind Method not Variable', () => {
    const items = scriptCompletions('input.', { line: 0, character: 6 });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.kind).toBe(LsCompletionItemKind.Method);
    }
  });
});
