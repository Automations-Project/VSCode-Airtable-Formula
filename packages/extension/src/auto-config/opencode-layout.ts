// Ported and modified from neondatabase/add-mcp src/opencode-config.ts
// at 5ae1d29a406568b1dedbaa4bd3b8a6fd7ef2195c (https://github.com/neondatabase/add-mcp).
// Copyright 2025 Andre Landgraf. Licensed under the Apache License, Version 2.0;
// see packages/extension/THIRD_PARTY_NOTICES.md. Changes: pure functions over a parsed document;
// the servers/timeout name-collision branch is dropped (our names never collide).
//
// OpenCode config layouts. V1 puts server names directly under `mcp`; V2 puts them under
// `mcp.servers`. opencode.ai/docs/mcp-servers, read 2026-11-07: "V2 does not place server
// names directly under `mcp`". The page says nothing about V1 files being rejected, and
// upstream's rule still writes a new name into a V1 file as V1, so we do the same.
// Rule: native when the native map has the name; V1 when the V1 entries have it; native when a
// native map exists and there are no V1 entries; otherwise V1.

export interface OpenCodeLocation {
  /** The servers container; the caller appends the server name. */
  path: readonly string[];
  native: boolean;
}

const V1_LOCATION: OpenCodeLocation = { path: ['mcp'], native: false };
const NATIVE_LOCATION: OpenCodeLocation = { path: ['mcp', 'servers'], native: true };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** An OpenCode server entry: local/remote type, a url, a command, or an enablement-only stub. */
export function isOpenCodeServerEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.type === 'local' || value.type === 'remote') return true;
  if (typeof value.url === 'string' && value.url.length > 0) return true;
  if (typeof value.command === 'string' && value.command.length > 0) return true;
  if (Array.isArray(value.command) && value.command.length > 0) return true;
  return typeof value.enabled === 'boolean';
}

/** `mcp.timeout: { request: 5000 }` sits beside the servers and is not one. */
function isTimeoutMetadata(key: string, value: unknown): boolean {
  return key === 'timeout' && isPlainObject(value) && !isOpenCodeServerEntry(value);
}

interface Classified {
  /** Server names (V1 layout) directly under `mcp`. */
  v1: Set<string>;
  /** The `mcp.servers` map, when there is one. */
  native: Record<string, unknown> | null;
}

function classify(doc: Record<string, unknown>, file: string): Classified {
  const mcp = doc.mcp;
  if (mcp === undefined) return { v1: new Set(), native: null };
  if (!isPlainObject(mcp)) throw new Error(`${file} mcp must be a JSON object`);
  let native: Record<string, unknown> | null = null;
  const v1 = new Set<string>();
  for (const [key, value] of Object.entries(mcp)) {
    if (key === 'servers') {
      if (isOpenCodeServerEntry(value)) v1.add(key); // a V1 server literally named "servers"
      else if (isPlainObject(value)) native = value;
      else throw new Error(`${file} mcp.servers must be a JSON object`);
    } else if (isOpenCodeServerEntry(value) && !isTimeoutMetadata(key, value)) {
      v1.add(key);
    }
  }
  return { v1, native };
}

/** Where a write of `serverName` goes: its current container, else per the layout rule above. */
export function openCodeWritePath(doc: Record<string, unknown>, serverName: string, file: string): OpenCodeLocation {
  const { v1, native } = classify(doc, file);
  if (native && has(native, serverName)) return NATIVE_LOCATION;
  if (v1.has(serverName)) return V1_LOCATION;
  if (native && v1.size === 0) return NATIVE_LOCATION;
  return V1_LOCATION;
}

/** Every container that currently holds `serverName`, native first (upstream removeOpenCodeServer). */
export function openCodeEntryPaths(doc: Record<string, unknown>, serverName: string, file: string): OpenCodeLocation[] {
  const { v1, native } = classify(doc, file);
  const out: OpenCodeLocation[] = [];
  if (native && has(native, serverName)) out.push(NATIVE_LOCATION);
  if (v1.has(serverName)) out.push(V1_LOCATION);
  return out;
}
