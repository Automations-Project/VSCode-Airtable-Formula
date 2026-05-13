import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_GLOBALS,
  AUTOMATION_GLOBAL_NAMES,
  getAutomationGlobal,
} from '../../engines/automation/index.js';

describe('AUTOMATION_GLOBALS', () => {
  it('contains exactly 5 top-level globals', () => {
    expect(AUTOMATION_GLOBAL_NAMES).toHaveLength(5);
    for (const name of ['base', 'table', 'input', 'output', 'fetch']) {
      expect(AUTOMATION_GLOBALS[name], `Expected "${name}" to be defined`).toBeDefined();
    }
  });

  it('does NOT contain cursor, session, or remoteFetchAsync', () => {
    expect(AUTOMATION_GLOBALS['cursor']).toBeUndefined();
    expect(AUTOMATION_GLOBALS['session']).toBeUndefined();
    expect(AUTOMATION_GLOBALS['remoteFetchAsync']).toBeUndefined();
  });

  it('base has exactly 5 methods', () => {
    expect(Object.keys(AUTOMATION_GLOBALS['base'].methods)).toHaveLength(5);
    for (const m of ['id', 'name', 'tables', 'getTables', 'getTable']) {
      expect(AUTOMATION_GLOBALS['base'].methods[m], `base.${m} missing`).toBeDefined();
    }
  });

  it('base does NOT have createTableAsync, getCollaborators, activeCollaborators', () => {
    expect(AUTOMATION_GLOBALS['base'].methods['createTableAsync']).toBeUndefined();
    expect(AUTOMATION_GLOBALS['base'].methods['getCollaborators']).toBeUndefined();
    expect(AUTOMATION_GLOBALS['base'].methods['activeCollaborators']).toBeUndefined();
  });

  it('table has exactly 14 methods', () => {
    expect(Object.keys(AUTOMATION_GLOBALS['table'].methods)).toHaveLength(14);
    for (const m of [
      'id', 'name', 'fields', 'views', 'getField', 'getView',
      'selectRecordsAsync', 'selectRecordAsync',
      'createRecordAsync', 'createRecordsAsync',
      'updateRecordAsync', 'updateRecordsAsync',
      'deleteRecordAsync', 'deleteRecordsAsync',
    ]) {
      expect(AUTOMATION_GLOBALS['table'].methods[m], `table.${m} missing`).toBeDefined();
    }
  });

  it('table does NOT have createFieldAsync', () => {
    expect(AUTOMATION_GLOBALS['table'].methods['createFieldAsync']).toBeUndefined();
  });

  it('input has only config method', () => {
    expect(Object.keys(AUTOMATION_GLOBALS['input'].methods)).toEqual(['config']);
  });

  it('output has only set method', () => {
    expect(Object.keys(AUTOMATION_GLOBALS['output'].methods)).toEqual(['set']);
  });

  it('fetch has zero methods', () => {
    expect(Object.keys(AUTOMATION_GLOBALS['fetch'].methods)).toHaveLength(0);
  });

  it('getAutomationGlobal returns the entry for a known global', () => {
    const g = getAutomationGlobal('base');
    expect(g).toBeDefined();
    expect(g!.description).toBeTruthy();
  });

  it('getAutomationGlobal returns undefined for unknown name', () => {
    expect(getAutomationGlobal('unknownXYZ')).toBeUndefined();
  });
});
