// packages/extension/src/test/mcp-clients-snapshot.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MCP_CLIENTS } from '../auto-config/mcp-clients.js';

const root = new URL('../../../../', import.meta.url);
const snapshot = JSON.parse(fs.readFileSync(new URL('scripts/mcp-clients-upstream.json', root), 'utf8'));

describe('table and add-mcp snapshot', () => {
  it('every row maps to a ported upstream agent under our id, or is listed as ours only', () => {
    for (const r of MCP_CLIENTS) {
      if (r.upstream === null) expect(snapshot.oursOnly, r.id).toContain(r.id);
      else expect(snapshot.agents[r.upstream], r.id).toMatchObject({ ported: true, ourId: r.id });
    }
    expect(MCP_CLIENTS.filter(r => r.upstream === null).map(r => r.id).sort()).toEqual([...snapshot.oursOnly].sort());
  });

  it("the drift script's text extraction sees exactly the table's rows", async () => {
    const { extractTableRows } = await import(pathToFileURL(fileURLToPath(new URL('scripts/check-mcp-clients.mjs', root))).href);
    const text = fs.readFileSync(new URL('../auto-config/mcp-clients.ts', import.meta.url), 'utf8');
    expect(extractTableRows(text)).toEqual(MCP_CLIENTS.map(r => ({ id: r.id, upstream: r.upstream })));
  });
});
