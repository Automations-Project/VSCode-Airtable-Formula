import { describe, it, expect } from 'vitest';
import { automationHover } from '../../engines/automation/index.js';

describe('automationHover — global hover', () => {
  it('returns non-null hover for "base" at char 0', () => {
    const hover = automationHover('base', { line: 0, character: 0 });
    expect(hover).not.toBeNull();
    expect(hover!.contents.kind).toBe('markdown');
  });

  it('hover content for base contains "automation"', () => {
    const hover = automationHover('base', { line: 0, character: 2 });
    expect(hover!.contents.value.toLowerCase()).toContain('automation');
  });

  it('returns non-null hover for "input" at char 0', () => {
    const hover = automationHover('input', { line: 0, character: 0 });
    expect(hover).not.toBeNull();
  });

  it('input hover mentions config()', () => {
    const hover = automationHover('input', { line: 0, character: 0 });
    expect(hover!.contents.value).toContain('config');
  });

  it('returns non-null hover for "fetch" at char 0', () => {
    const hover = automationHover('fetch', { line: 0, character: 0 });
    expect(hover).not.toBeNull();
  });

  it('returns null for "cursor" — not an automation global', () => {
    const hover = automationHover('cursor', { line: 0, character: 0 });
    expect(hover).toBeNull();
  });

  it('returns null for "session" — not an automation global', () => {
    const hover = automationHover('session', { line: 0, character: 0 });
    expect(hover).toBeNull();
  });

  it('returns null for "remoteFetchAsync" — not an automation global', () => {
    const hover = automationHover('remoteFetchAsync', { line: 0, character: 0 });
    expect(hover).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(automationHover('', { line: 0, character: 0 })).toBeNull();
  });
});

describe('automationHover — method hover', () => {
  it('returns method hover for getTable at char 6 in "base.getTable()"', () => {
    const text = 'base.getTable()';
    const hover = automationHover(text, { line: 0, character: 6 });
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('getTable');
  });

  it('hover on table.selectRecordsAsync shows signature', () => {
    const text = 'table.selectRecordsAsync({})';
    const hover = automationHover(text, { line: 0, character: 8 });
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('selectRecordsAsync');
  });

  it('hover on input.config at char 7', () => {
    const text = 'input.config()';
    const hover = automationHover(text, { line: 0, character: 7 });
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('config');
  });

  it('hover on output.set at char 8', () => {
    const text = 'output.set("key", "val")';
    const hover = automationHover(text, { line: 0, character: 8 });
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('set');
  });
});

describe('automationHover — unknown identifier', () => {
  it('returns null for unknown identifier', () => {
    const hover = automationHover('myLib.doThing()', { line: 0, character: 0 });
    expect(hover).toBeNull();
  });
});
