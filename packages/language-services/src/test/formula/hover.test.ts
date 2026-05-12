import { describe, it, expect } from 'vitest';
import { formulaHover } from '../../engines/formula/index.js';

describe('formulaHover — known function', () => {
  it('returns non-null hover with markdown content for IF at char 0', () => {
    const hover = formulaHover('IF(1, 2, 3)', { line: 0, character: 0 });
    expect(hover).not.toBeNull();
    expect(hover?.contents.kind).toBe('markdown');
    expect(hover?.contents.value).toContain('IF');
  });

  it('returns hover with range when hovering over a known function', () => {
    const hover = formulaHover('IF(1, 2, 3)', { line: 0, character: 0 });
    expect(hover?.range).toBeDefined();
    expect(hover?.range?.start.line).toBe(0);
  });
});

describe('formulaHover — TRUE and FALSE (gap fix D-05)', () => {
  it('returns non-null hover for TRUE in IF({x}, TRUE, FALSE)', () => {
    const text = 'IF({x}, TRUE, FALSE)';
    const trueOffset = text.indexOf('TRUE');
    const hover = formulaHover(text, { line: 0, character: trueOffset + 1 });
    expect(hover).not.toBeNull();
  });

  it('returns non-null hover for FALSE', () => {
    const text = 'IF({x}, TRUE, FALSE)';
    const falseOffset = text.indexOf('FALSE');
    const hover = formulaHover(text, { line: 0, character: falseOffset + 1 });
    expect(hover).not.toBeNull();
  });
});

describe('formulaHover — unknown identifier', () => {
  it('returns null for cursor on a number literal', () => {
    const hover = formulaHover('42', { line: 0, character: 0 });
    expect(hover).toBeNull();
  });
});
