import { describe, it, expect } from 'vitest';
import { formulaCompletions } from '../../engines/formula/index.js';
import { LsCompletionItemKind } from '../../index.js';

const pos = { line: 0, character: 0 };

describe('formulaCompletions — function items', () => {
  it('includes IF with kind Function (2)', () => {
    const items = formulaCompletions('', pos);
    const item = items.find(i => i.label === 'IF');
    expect(item).toBeDefined();
    expect(item?.kind).toBe(LsCompletionItemKind.Function);
  });

  it('includes AND and OR', () => {
    const items = formulaCompletions('', pos);
    expect(items.find(i => i.label === 'AND')).toBeDefined();
    expect(items.find(i => i.label === 'OR')).toBeDefined();
  });

  it('IF item has insertText "IF($0)" (single tab stop)', () => {
    const items = formulaCompletions('', pos);
    const item = items.find(i => i.label === 'IF');
    expect(item?.insertText).toBe('IF($0)');
  });

  it('does not include AUTONUMBER, CREATED_BY, LOG10, TEXT (gap fix D-05)', () => {
    const items = formulaCompletions('', pos);
    expect(items.find(i => i.label === 'AUTONUMBER')).toBeUndefined();
    expect(items.find(i => i.label === 'LOG10')).toBeUndefined();
    expect(items.find(i => i.label === 'TEXT')).toBeUndefined();
  });
});

describe('formulaCompletions — constants', () => {
  it('TRUE has kind Constant (20)', () => {
    const items = formulaCompletions('', pos);
    const item = items.find(i => i.label === 'TRUE');
    expect(item).toBeDefined();
    expect(item?.kind).toBe(LsCompletionItemKind.Constant);
  });

  it('FALSE and BLANK and NOW are present as constants', () => {
    const items = formulaCompletions('', pos);
    expect(items.find(i => i.label === 'FALSE')).toBeDefined();
    expect(items.find(i => i.label === 'BLANK')).toBeDefined();
    expect(items.find(i => i.label === 'NOW')).toBeDefined();
  });
});

describe('formulaCompletions — date unit items', () => {
  it("'days' item has kind Value (11)", () => {
    const items = formulaCompletions('', pos);
    const item = items.find(i => i.label === "'days'");
    expect(item).toBeDefined();
    expect(item?.kind).toBe(LsCompletionItemKind.Value);
  });

  it('includes all 7 date unit strings', () => {
    const items = formulaCompletions('', pos);
    for (const unit of ['days', 'weeks', 'months', 'years', 'hours', 'minutes', 'seconds']) {
      expect(items.find(i => i.label === `'${unit}'`)).toBeDefined();
    }
  });
});
