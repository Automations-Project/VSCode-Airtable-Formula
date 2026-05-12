import { describe, it, expect } from 'vitest';
import {
  FUNCTION_REGISTRY,
  CALLABLE_CONSTANTS,
  ALL_FUNCTION_NAMES,
  ALL_CALLABLE,
  getFunctionsByCategory,
  isValidCallable,
  getFunctionInfo,
} from '../../engines/formula/index.js';

describe('FUNCTION_REGISTRY', () => {
  it('contains IF with correct shape', () => {
    expect(FUNCTION_REGISTRY['IF']).toBeDefined();
    expect(FUNCTION_REGISTRY['IF'].category).toBe('Logical');
    expect(FUNCTION_REGISTRY['IF'].signature).toContain('IF(');
  });

  it('contains TRUE and FALSE (gap fix D-05)', () => {
    expect(FUNCTION_REGISTRY['TRUE']).toBeDefined();
    expect(FUNCTION_REGISTRY['TRUE'].category).toBe('Logical');
    expect(FUNCTION_REGISTRY['FALSE']).toBeDefined();
    expect(FUNCTION_REGISTRY['FALSE'].category).toBe('Logical');
  });

  it('does not contain AUTONUMBER, CREATED_BY, LAST_MODIFIED_BY, LOG10, TEXT (gap fix D-05)', () => {
    expect(FUNCTION_REGISTRY['AUTONUMBER']).toBeUndefined();
    expect(FUNCTION_REGISTRY['CREATED_BY']).toBeUndefined();
    expect(FUNCTION_REGISTRY['LAST_MODIFIED_BY']).toBeUndefined();
    expect(FUNCTION_REGISTRY['LOG10']).toBeUndefined();
    expect(FUNCTION_REGISTRY['TEXT']).toBeUndefined();
  });

  it('contains DATEDIF as legacy entry', () => {
    expect(FUNCTION_REGISTRY['DATEDIF']).toBeDefined();
  });
});

describe('CALLABLE_CONSTANTS', () => {
  it('contains exactly NOW, TODAY, BLANK, TRUE, FALSE (D-06)', () => {
    expect(CALLABLE_CONSTANTS).toContain('NOW');
    expect(CALLABLE_CONSTANTS).toContain('TODAY');
    expect(CALLABLE_CONSTANTS).toContain('BLANK');
    expect(CALLABLE_CONSTANTS).toContain('TRUE');
    expect(CALLABLE_CONSTANTS).toContain('FALSE');
    expect(CALLABLE_CONSTANTS).toHaveLength(5);
  });
});

describe('helper functions', () => {
  it('ALL_FUNCTION_NAMES includes IF', () => {
    expect(ALL_FUNCTION_NAMES).toContain('IF');
  });

  it('ALL_CALLABLE includes both registry functions and constants', () => {
    expect(ALL_CALLABLE).toContain('IF');
    expect(ALL_CALLABLE).toContain('NOW');
    expect(ALL_CALLABLE).toContain('TRUE');
  });

  it('isValidCallable returns true for known functions', () => {
    expect(isValidCallable('IF')).toBe(true);
    expect(isValidCallable('NOW')).toBe(true);
    expect(isValidCallable('TRUE')).toBe(true);
  });

  it('isValidCallable returns false for unknown names', () => {
    expect(isValidCallable('NOTAFUNC')).toBe(false);
  });

  it('getFunctionsByCategory returns Text functions including CONCATENATE', () => {
    const textFns = getFunctionsByCategory('Text');
    expect(textFns).toContain('CONCATENATE');
  });

  it('getFunctionInfo returns correct FunctionInfo for IF', () => {
    const info = getFunctionInfo('IF');
    expect(info).toBeDefined();
    expect(info?.category).toBe('Logical');
  });

  it('getFunctionInfo returns undefined for unknown name', () => {
    expect(getFunctionInfo('NOTAFUNC')).toBeUndefined();
  });
});
