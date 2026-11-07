import { describe, it, expect } from 'vitest';
import { isOpenCodeServerEntry, openCodeEntryPaths, openCodeWritePath } from '../auto-config/opencode-layout.js';

const N = 'airtable-user-mcp';
const F = '/h/.config/opencode/opencode.jsonc';
const V1 = { path: ['mcp'], native: false };
const V2 = { path: ['mcp', 'servers'], native: true };
const server = { type: 'local', command: ['x'] };

describe('openCodeWritePath (upstream resolveOpenCodeUpsertKey)', () => {
  it('a file without mcp, or with only V1 servers, gets the V1 location', () => {
    expect(openCodeWritePath({}, N, F)).toEqual(V1);
    expect(openCodeWritePath({ mcp: { other: server } }, N, F)).toEqual(V1);
  });
  it('a V2-only file gets the V2 location', () => {
    expect(openCodeWritePath({ mcp: { servers: { other: server } } }, N, F)).toEqual(V2);
    expect(openCodeWritePath({ mcp: { servers: {} } }, N, F)).toEqual(V2);
  });
  it('a mixed file gets V1 for a new name', () => {
    expect(openCodeWritePath({ mcp: { servers: { a: server }, b: server } }, N, F)).toEqual(V1);
  });
  it('an existing entry keeps its layout', () => {
    expect(openCodeWritePath({ mcp: { servers: { [N]: server }, b: server } }, N, F)).toEqual(V2);
    expect(openCodeWritePath({ mcp: { servers: { a: server }, [N]: server } }, N, F)).toEqual(V1);
  });
  it('a V1 server literally named "servers" is not a V2 map', () => {
    expect(openCodeWritePath({ mcp: { servers: { type: 'local', command: ['z'] } } }, N, F)).toEqual(V1);
  });
  it('mcp.timeout metadata is not a server', () => {
    expect(openCodeWritePath({ mcp: { servers: {}, timeout: { request: 5000 } } }, N, F)).toEqual(V2);
    expect(openCodeWritePath({ mcp: { timeout: { request: 5000 } } }, N, F)).toEqual(V1);
  });
  it('refuses a non-object mcp or mcp.servers', () => {
    expect(() => openCodeWritePath({ mcp: 3 }, N, F)).toThrow(`${F} mcp must be a JSON object`);
    expect(() => openCodeWritePath({ mcp: [] }, N, F)).toThrow(`${F} mcp must be a JSON object`);
    expect(() => openCodeWritePath({ mcp: { servers: 3 } }, N, F)).toThrow(`${F} mcp.servers must be a JSON object`);
  });
});

describe('openCodeEntryPaths', () => {
  it('finds our entry in either layout, native first', () => {
    expect(openCodeEntryPaths({ mcp: { servers: { [N]: server }, [N]: server } }, N, F)).toEqual([V2, V1]);
    expect(openCodeEntryPaths({ mcp: { other: server } }, N, F)).toEqual([]);
  });
  it('finds our entry under only the other key so Update can migrate it', () => {
    expect(openCodeEntryPaths({ mcp: { servers: { [N]: server }, b: server } }, N, F)).toEqual([V2]);
    expect(openCodeEntryPaths({ mcp: { servers: { a: server }, [N]: server } }, N, F)).toEqual([V1]);
  });
  it('is empty without mcp and ignores a V1 server named "servers"', () => {
    expect(openCodeEntryPaths({}, N, F)).toEqual([]);
    expect(openCodeEntryPaths({ mcp: { servers: { type: 'local', command: ['z'] } } }, N, F)).toEqual([]);
  });
  it('refuses a non-object mcp or mcp.servers like the write path', () => {
    expect(() => openCodeEntryPaths({ mcp: 3 }, N, F)).toThrow(`${F} mcp must be a JSON object`);
    expect(() => openCodeEntryPaths({ mcp: { servers: 3 } }, N, F)).toThrow(`${F} mcp.servers must be a JSON object`);
  });
});

describe('isOpenCodeServerEntry', () => {
  it('recognises local, remote, url, command and enablement-only entries', () => {
    for (const v of [{ type: 'local' }, { type: 'remote' }, { url: 'https://x' }, { command: 'x' }, { command: ['x'] }, { enabled: false }]) {
      expect(isOpenCodeServerEntry(v), JSON.stringify(v)).toBe(true);
    }
    for (const v of [null, [], { request: 5 }, { command: [] }, { url: '' }]) {
      expect(isOpenCodeServerEntry(v), JSON.stringify(v)).toBe(false);
    }
  });
});
