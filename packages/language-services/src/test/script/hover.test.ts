import { describe, it, expect } from 'vitest';
import { scriptHover } from '../../engines/script/index.js';

describe('scriptHover — global hover', () => {
  it('returns non-null hover for "base" at char 0', () => {
    const hover = scriptHover('base', { line: 0, character: 0 });
    expect(hover).not.toBeNull();
    expect(hover!.contents.kind).toBe('markdown');
  });

  it('hover content for base contains global description', () => {
    const hover = scriptHover('base', { line: 0, character: 2 });
    expect(hover!.contents.value).toContain('base');
  });
});

describe('scriptHover — method hover', () => {
  it('returns method hover for getTables at char 6 in "base.getTables()"', () => {
    const text = 'base.getTables()';
    const hover = scriptHover(text, { line: 0, character: 6 });
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('getTables');
  });

  it('hover on method shows signature', () => {
    const text = 'table.selectRecordsAsync({})';
    const hover = scriptHover(text, { line: 0, character: 8 });
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('selectRecordsAsync');
  });
});

describe('scriptHover — unknown identifier', () => {
  it('returns null for unknown identifier', () => {
    const hover = scriptHover('myLib.doThing()', { line: 0, character: 0 });
    expect(hover).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(scriptHover('', { line: 0, character: 0 })).toBeNull();
  });
});
