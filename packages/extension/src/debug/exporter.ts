import * as vscode from 'vscode';
import type { DebugEvent, DebugCollector } from './collector.js';

// ─── Redaction ────────────────────────────────────────────────

const STRUCTURAL_ID_RE = /^(app|tbl|fld|viw|rec|flt|sel|blk|ext|col|usr|wsp)[A-Za-z0-9]+$/;

const ALWAYS_STRIP_KEYS = new Set([
  '_csrf', 'csrf', 'csrfToken',
  'secretSocketId',
  'cookie', 'cookies', 'set-cookie',
  'password', 'otpSecret', 'otpCode', 'totp',
  'AIRTABLE_PASSWORD', 'AIRTABLE_OTP_SECRET', 'AIRTABLE_EMAIL',
  'authorization', 'apiKey', 'api_key', 'token', 'accessToken',
  'refreshToken', 'bearer', 'privateKey', 'private_key',
  'stringifiedObjectParams',
]);

const REDACT_VALUE_KEYS = new Set([
  'value', 'name', 'description', 'text', 'label',
  'email', 'username',
]);

// Cycle-safe redaction — mirrors the MCP-side tracer fix. A self-referencing
// payload (or a hostile Proxy from an LLM tool call that ends up in a trace)
// must not crash the whole export.
function redactValue(key: string, val: unknown, seen: WeakSet<object>): unknown {
  if (val === null || val === undefined) return val;
  if (ALWAYS_STRIP_KEYS.has(key)) return '[REDACTED]';

  if (typeof val === 'string') {
    if (STRUCTURAL_ID_RE.test(val)) return val;
    if (val.startsWith('https://airtable.com/')) {
      return val.replace(/v0\.3\//, '').replace(
        /(app|tbl|viw|fld|rec|usr|wsp|sel|flt|blk|ext|col)[A-Za-z0-9]{10,}/g,
        '$1*',
      );
    }
    if (REDACT_VALUE_KEYS.has(key)) return '[REDACTED]';
    return val;
  }

  if (typeof val !== 'object') return val;

  // Cycle detection: `finally { seen.delete(val) }` means we treat `seen` as a
  // path-set (branch-local) rather than a whole-walk visited-set, so legitimate
  // DAGs aren't falsely collapsed.
  if (seen.has(val as object)) return '[Circular]';
  seen.add(val as object);

  try {
    if (Array.isArray(val)) {
      return val.map((item, i) => redactValue(String(i), item, seen));
    }
    return redactObject(val as Record<string, unknown>, seen);
  } catch {
    // Hostile Proxy or unreadable object — drop to a sentinel so the rest of
    // the event still exports.
    return '[Unserializable]';
  } finally {
    seen.delete(val as object);
  }
}

function redactObject(obj: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  try {
    // Object.entries throws on a Proxy that traps `ownKeys`; the caller catches.
    for (const [key, val] of Object.entries(obj)) {
      result[key] = redactValue(key, val, seen);
    }
  } catch {
    return { _redactionFailed: true };
  }
  return result;
}

function redactEvent(event: DebugEvent): DebugEvent {
  try {
    return {
      ...event,
      data: redactObject(event.data, new WeakSet()),
    };
  } catch {
    // Absolute last-resort — event shape itself was degenerate. Emit a
    // breadcrumb so export doesn't lose the whole log for one bad event.
    return {
      ...event,
      data: { _redactionFailed: true },
    };
  }
}

// ─── Export ───────────────────────────────────────────────────

interface ExportMeta {
  generator: string;
  format_version: string;
  exported_at: string;
  extension_version: string;
  mcp_version: string;
  platform: string;
  vscode_version: string;
  node_version: string;
  redaction: string;
  session: { started: string; ended: string } | null;
  event_count: number;
  buffer_capacity: number;
  events_dropped: number;
}

export interface ExportResult {
  meta: ExportMeta;
  events: DebugEvent[];
}

export async function exportDebugLog(
  collector: DebugCollector,
  session: { start: string; end: string } | null,
  extensionVersion: string,
  bufferCapacity: number,
): Promise<vscode.Uri | undefined> {
  const { events, eventsDropped } = collector.export(session !== null);
  const redacted = events.map(redactEvent);

  let mcpVersion = 'unknown';
  try {
    const versionFiles = await vscode.workspace.findFiles('**/dist/mcp/version.json', null, 1);
    if (versionFiles.length > 0) {
      const raw = await vscode.workspace.fs.readFile(versionFiles[0]);
      const parsed = JSON.parse(Buffer.from(raw).toString());
      mcpVersion = parsed.version || 'unknown';
    }
  } catch { /* best-effort */ }

  const output: ExportResult = {
    meta: {
      generator: 'airtable-formula-debug',
      format_version: '1.0',
      exported_at: new Date().toISOString(),
      extension_version: extensionVersion,
      mcp_version: mcpVersion,
      platform: process.platform,
      vscode_version: vscode.version,
      node_version: process.version,
      redaction:
        'moderate — auth tokens stripped, field values/names replaced with [REDACTED], ' +
        'structural IDs (app/tbl/fld/viw/rec/flt) preserved for diagnosis',
      session: session ? { started: session.start, ended: session.end } : null,
      event_count: redacted.length,
      buffer_capacity: bufferCapacity,
      events_dropped: eventsDropped,
    },
    events: redacted,
  };

  const json = JSON.stringify(output, null, 2);

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(
      `airtable-debug-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`,
    ),
    filters: { 'JSON Files': ['json'] },
    title: 'Export Airtable Debug Log',
  });

  if (!uri) return undefined;

  await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf8'));
  return uri;
}
