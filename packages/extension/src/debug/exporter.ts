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
]);

const REDACT_VALUE_KEYS = new Set([
  'value', 'name', 'description', 'text', 'label',
  'email', 'username',
]);

function redactValue(key: string, val: unknown): unknown {
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

  if (Array.isArray(val)) {
    return val.map((item, i) => redactValue(String(i), item));
  }

  if (typeof val === 'object') {
    return redactObject(val as Record<string, unknown>);
  }

  return val;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = redactValue(key, val);
  }
  return result;
}

function redactEvent(event: DebugEvent): DebugEvent {
  return {
    ...event,
    data: redactObject(event.data),
  };
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
      session,
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
